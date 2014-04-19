var EventEmitter = require('events').EventEmitter;
var Winston = require("winston");
var Util = require("util");
var Promise = require('promise');

function RPCException(message, value) {
    this.value = value || 0;
    this.message = message;
    this.toString = function () {
      return this.message;
    };
}

function _process(data) {
    var response;
    var self = this;

    try {
        
        response = JSON.parse(data);
        Winston.debug(Util.format(
            "\x1b[1;30mHTTP [%s] <= %s\x1b[0m", 
            response.id || 'N/A', JSON.stringify(response)
        ));
    }
    catch (e) {        
       Winston.error(Util.format(
           "\x1b[31mHTTP ERROR: %s\x1b[0m", JSON.stringify(e)
       ));
       return;
    }
    
    if (response.jsonrpc !== '2.0') {
        Winston.error(Util.format(
            "\x1b[31mInvalid Request: %s[0m", JSON.stringify(response)
        ));
        return;
    }

    if (response.id && self.promisedRequests.hasOwnProperty(response.id)) {
        var rq = self.promisedRequests[response.id];
        clearTimeout(rq.timeout);
        delete self.promisedRequests[response.id];

        if (response.hasOwnProperty('result')) {
            rq.resolve(response.result);
        }
        else if (response.hasOwnProperty('error')){
            rq.reject(response.error);
        }
        else {
            rq.reject({code: 0, message: "Unknown Error"});
        }

    }
    
}

function _processRequest(data, response) {
    var request;
    var self = this;
    
    try {
        
        request = JSON.parse(data);
        Winston.debug(Util.format(
            "\x1b[1;30mHTTP [%s] <= %s\x1b[0m", 
            request.id || 'N/A', JSON.stringify(request)
        ));

    }
    catch (e) {        
        response.apply(self, [{
            jsonrpc:'2.0',
            error: {
                code: -32700,
                message: 'Parse error'
            }
        }]);
       return;
    }
    
    if (request.jsonrpc !== '2.0') {
        response.apply(self, [{
            jsonrpc:'2.0',
            error: {
                code: -32600,
                message: 'Invalid Request'
            }
        }]);
        return;
    }

    if (request.hasOwnProperty('method')) {

        function _response_cb(e, result) {
            
            if (e) {
                if (request.id) {
                    response.apply(self, [{
                        jsonrpc: "2.0",
                        error: {
                            code: e.code || -32603,
                            message: e.message || "Internal Error"
                        },
                        id: request.id
                    }]);    
                }
            }
            else {
                if (result !== undefined && request.id) {                
                    response.apply(self, [{
                        jsonrpc: "2.0",
                        result: result,
                        id: request.id
                    }]);                   
                }

            }
            
        }

        var cb = self._callings[request.method];
        if (!cb) _response_cb({code: -32601, message: 'Method not found'});
        
        try {
            var result = cb.apply(self, [request.params]);
        } catch (e) {
            if (e instanceof RPCException) {
                _response_cb(e);
            } else {
                throw e;
            }        
        }
        
        if (typeof(result) == 'function') {
            // deferred callback
            result(_response);
        } else {
            _response_cb(null, result);
        }

    } else {
        response.apply(self, [{
            jsonrpc:'2.0',
            error: {
                code: -32600,
                message: 'Invalid Request'
            }
        }]);
    }
    
    
}

var RPC = function () {
    this.promisedRequests = {};
    this._callings = {};
    this.callTimeout = 5000;
    this.isServer = false;
    this.Exception = RPCException;
};

// inherit EventEmitter
RPC.prototype.__proto__ = EventEmitter.prototype;

var _uniqsec = 0;
var _uniqid = 0;
var Moment = require('moment');

RPC.prototype.getUniqueId = function () {

    var sec = Moment().valueOf();
    if (sec !== _uniqsec) {
        _uniqsec = sec;
        _uniqid  = 0;
    }
    else {
        _uniqid ++;
    }
    return _uniqsec.toString(36) + _uniqid.toString();
}

RPC.prototype.calling = function (method, cb) {
    var self = this;
    self._callings[method] = cb;
    return self;
}

RPC.prototype.removeCalling = function (key) {
    var self = this;
    if (self._callings.hasOwnProperty(key)) delete self._callings[key];
    return self;
}

RPC.prototype.removeCallings = function (pattern) {
    var self = this;
    var wildcard = require('wildcard');

    wildcard(pattern, Object.keys(self._callings)).forEach(function (key){
        delete self._callings[key];
    });

    return self;
}

RPC.prototype.call = function (method, params) {
    
    var self = this;
    
    return new Promise(function(resolve, reject){
        var id = self.getUniqueId();
    
        var data = {
            jsonrpc:'2.0',
            method: method,
            params: params || [],
            id: id
        };
    
        Winston.debug(Util.format(
            "\x1b[1;30mHTTP hostname=%s port=%s path=%s\x1b[0m", 
            self.hostname, self.port, self.path
        ));    

        Winston.debug(Util.format(
            "\x1b[1;30mHTTP [%s] => %s\x1b[0m", 
            id, JSON.stringify(data)
        ));    

        self.promisedRequests[id] = {
            method: method,
            params: params,
            resolve: resolve,
            reject: reject
        };

        self.promisedRequests[id].timeout = setTimeout(function (){
            Winston.debug(Util.format("HTTP [%s] <= timeout", id));
            delete self.promisedRequests[id];
            reject({
                code: -32603,
                message: "Call Timeout"
            });
        }, self.callTimeout);

        var post = new Buffer(JSON.stringify(data));

        var request = require('http').request({
            hostname: self.hostname,
            port: self.port,
            path: self.path,
            headers: {
                'Content-Length': post.length
            },
            method: 'POST'
        })
    
        request
        .on('error', function (err){
            Winston.error(Util.format(
                "HTTP error: %s code: %d", 
                err.message, err.code
            ));
            clearTimeout(self.promisedRequests[id].timeout);
            delete self.promisedRequests[id];
            reject({
                code: -32603,
                message: "Internal error"
            })
        })
        .on('response', function (response) {
            
            if (response.statusCode !== 200) {
                request.emit('error', {
                    code: -1,
                    message: "Status code is not 200"
                });
                return;
            }

            var data = new Buffer(0);
            response
            .on('data', function (d) {
                data = Buffer.concat([data, d]);
            })
            .on('end', function () {
                _process.apply(self, [data]);
            });
        })
    
        request.end(post);
    
    });
    
};

RPC.prototype.connect = function (url, query) {
    
    var self = this;
    self.isServer = false;
    
    var u = require('url').parse(url, true);
    
    self.hostname = u.hostname;
    self.port = u.port || 80;
    u.query = u.query || {};
    if (query) {
        require('lodash').extend(u.query, query);
    }

    self.path = require('url').format({pathname:u.pathname, query:u.query});
    Winston.info(Util.format(
        'HTTP-RPC hostname:%s port:%d path:%s', 
        self.hostname, self.port, self.path
    ));
    
    return self;
};

RPC.prototype.process = function (req, res) {
    
    var self = this;
    
    var data = new Buffer(0);

    req
    .on('data', function (d) {
        data = Buffer.concat([data, d]);
    })
    .on('end', function () {
        _processRequest.apply(self, [data, function(ret) {
            res.end(JSON.stringify(ret));
        }]);
    });
  
}

module.exports = {
    connect: function (url, query) {
        var rpc = new RPC();
        return rpc.connect(url, query);
    },
    server: function () {
        var rpc = new RPC();
        rpc.isServer = true;
        return rpc;
    }
};
