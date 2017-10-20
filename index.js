var EventEmitter = require('events').EventEmitter;
var Winston = require("winston");
var Util = require("util");
var Promise = require('promise');

function RPCException(message, code) {
    this.code = code || 0;
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
        self.logger.debug(Util.format(
            "HTTP [%s] <= %s", 
            response.id || 'N/A', JSON.stringify(response)
        ));
    }
    catch (e) {        
       self.logger.error(Util.format(
           "HTTP ERROR: %s", JSON.stringify(e)
       ));
       return;
    }
    
    if (response.jsonrpc !== '2.0') {
        self.logger.error(Util.format(
            "Invalid Request: %s", JSON.stringify(response)
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
        self.logger.debug(Util.format(
            "HTTP [%s] <= %s", 
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
        if (!cb) {
            _response_cb({code: -32601, message: 'Method not found'});
            return;
        }
        
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
            result(_response_cb);
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
    this.Exception = RPCException;
    this.logger = new Winston.Logger();
    this.maxConcurrency = 0;
    this.concurrency = 0;
    this.requestQueue = [];
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

RPC.prototype.notify = function (method, params) {
    return this._call(method, params, true);
}

RPC.prototype.call = function (method, params) {
    return this._call(method, params, false);
}

RPC.prototype._call = function (method, params, notif) {
    
    var self = this;
    
    return new Promise(function(resolve, reject){

        var throttle = (function(resolve, reject){
            return {
                resolve: function() {
                    resolve.apply(this, arguments);
                    _popRequest();
                },
                reject: function() {
                    reject.apply(this, arguments);
                    _popRequest();
                }
            }
            
        })(resolve, reject);
        
        resolve = throttle.resolve;
        reject = throttle.reject;

        if (self.maxConcurrency == 0 || self.concurrency < self.maxConcurrency) {
            _triggerRequest(method, params, resolve, reject);
        } else {
            self.requestQueue.push({method: method, params: params, resolve: resolve, reject: reject });
        }
    
        function _popRequest() {
            if (self.concurrency > 0) self.concurrency--;
            if (self.requestQueue.length > 0) {
                var o = self.requestQueue.pop();
                _triggerRequest(o.method, o.params, o.resolve, o.reject);
            }
        }
        
        function _triggerRequest(method, params, resolve, reject) {

            var id;

            var data = {
                jsonrpc:'2.0',
                method: method,
                params: params || []
            };

            if (!notif) {
                id = data.id = self.getUniqueId();
            }
        
            self.logger.debug(Util.format(
                "HTTP hostname=%s port=%s path=%s", 
                self.hostname, self.port, self.path
            ));    

            if (id) {
                self.logger.debug(Util.format(
                    "HTTP [%s] => %s",
                    id, JSON.stringify(data)
                ));

                self.promisedRequests[id] = {
                    method: method,
                    params: params,
                    resolve: resolve,
                    reject: reject
                };

                self.promisedRequests[id].timeout = setTimeout(function () {
                    self.logger.debug(Util.format("HTTP [%s] <= timeout", id));
                    delete self.promisedRequests[id];
                    reject({
                        code: -32603,
                        message: "Call Timeout"
                    });
                }, self.callTimeout);

            } else {
                self.logger.debug(Util.format(
                    "HTTP [notif] => %s",
                    JSON.stringify(data)
                ));
            }

            var post = new Buffer(JSON.stringify(data));

            var opt = {
                hostname: self.hostname,
                port: self.port,
                path: self.path,
                headers: {
                    'Content-Length': post.length,
                    'Content-Type': 'application/json'
                },
                method: 'POST'
            };

            if (self.cookie) opt.headers['Cookie'] = self.cookie;

            self.emit('beforeRequest', opt, post);

            var request = require('http').request(opt);

            request
            .on('error', function (err){
                self.logger.error(Util.format(
                    "HTTP error: %s code: %d", 
                    err.message, err.code
                ));
                if (id && self.promisedRequests[id]) {
                    if (self.promisedRequests[id].timeout) {
                        clearTimeout(self.promisedRequests[id].timeout);
                    }
                    delete self.promisedRequests[id];
                }
                reject({
                    code: -32603,
                    message: "Internal error"
                })
            })
            .on('response', function (response) {
                if (response.headers['set-cookie']) {
                    self.cookie = response.headers['set-cookie'];
                }
        
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
                    if (id) {
                        _process.apply(self, [data]);
                    } else {
                        resolve();
                    }
                });
            })

            request.end(post);
            self.concurrency++;    
        }

    });
    
};

RPC.prototype.connect = function (url, query) {
    
    var self = this;
    
    var u = require('url').parse(url, true);
    
    self.hostname = u.hostname;
    self.port = u.port || 80;
    u.query = u.query || {};
    if (query) {
        require('lodash').extend(u.query, query);
    }

    self.path = require('url').format({pathname:u.pathname, query:u.query});
    self.logger.info(Util.format(
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

var RPCWrapper = function() {
    return new RPC();
}

RPCWrapper.connect = function (url, query) {
    var rpc = new RPC();
    return rpc.connect(url, query);
};

RPCWrapper.server = function () {
    var rpc = new RPC();
    return rpc;
};

module.exports = RPCWrapper;
