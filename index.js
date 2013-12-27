var EventEmitter = require('events').EventEmitter;
var GUtil = require("genee-util");

function RPCException(message, value) {
    this.value = value || 0;
    this.message = message;
    this.toString = function () {
      return this.message;
    };
}

function _process(self, data) {
    var request;

    try {
        
        request = JSON.parse(data);
        GUtil.log(GUtil.LOG_DEBUG, "\x1b[1;30mHTTP [%s] <= %s\x1b[0m\n", request.id || 'N/A', JSON.stringify(request));

        if (request.jsonrpc !== '2.0') throw new RPCException('Invalid Request', -32600);
    }
    catch (e) {        
       GUtil.log(GUtil.LOG_ERROR, "\x1b[31mHTTP ERROR: %s\x1b[0m\n", JSON.stringify(e));
       return;
    }
    
    if (request.id && self.deferredRequest.hasOwnProperty(request.id)) {
        var rq = self.deferredRequest[request.id];
        clearTimeout(rq.timeout);
        delete self.deferredRequest[request.id];

        if (request.hasOwnProperty('result')) {
            rq.deferred.resolve(request.result);
        }
        else if (request.hasOwnProperty('error')){
            rq.deferred.reject(request.error);
        }
        else {
            rq.deferred.reject({code: 0, message: "Unknown Error"});
        }

    }
    
}

var RPC = function (url, query) {

    var self = this;

    self.deferredRequest = {};
    self.RPCCallback = {};
    self.Exception = RPCException;

    var url = require('url').parse(url, true);
    
    self.hostname = url.hostname;
    self.port = url.port || 80;
    url.query = url.query || {};
    if (query) {
        require('lodash').extend(url.query, query);
    }

    self.path = require('url').format({pathname:url.pathname, query:url.query});
    GUtil.log(GUtil.LOG_INFO, 'HTTP-RPC hostname:%s port:%d path:%s\n', self.hostname, self.port, self.path);
    
    return self;
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

RPC.prototype.call = function (method, params, callback, timeout) {
    
    var self = this;
    
    var Deferred = require('simply-deferred').Deferred;
    var d = new Deferred();
    
    var id = self.getUniqueId();
    
    var data = {
        jsonrpc:'2.0',
        method: method,
        params: params || [],
        id: id
    };
    
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
    
    // GUtil.log(GUtil.LOG_DEBUG, "\x1b[1;30mHTTP hostname=%s port=%s path=%s\x1b[0m\n", self.hostname, self.port, self.path);    

    request
    .on('error', function (err){
        GUtil.log(GUtil.LOG_ERROR, "HTTP error: %s\n", err.message);
        clearTimeout(self.deferredRequest[id].timeout);
        delete self.deferredRequest[id];
        d.reject({
            code: -32603,
            message: "Internal error"
        })
    })
    .on('response', function (response) {
        if (response.statusCode !== 200) return;
        var data = new Buffer(0);
        response
        .on('data', function (d) {
            data = Buffer.concat([data, d]);
        })
        .on('end', function () {
            _process(self, data);
        });
    })
    
    GUtil.log(GUtil.LOG_DEBUG, "\x1b[1;30mHTTP [%s] => %s\x1b[0m\n", id, JSON.stringify(data));    
    request.end(post);
    
    self.deferredRequest[id] = {
        method: method,
        params: params,
        deferred: d
    };

    self.deferredRequest[id].timeout = setTimeout(function (){
        GUtil.log(GUtil.LOG_DEBUG, "HTTP [%s] <= timeout\n", id);
        delete self.deferredRequest[id];
        d.reject({
            code: -32603,
            message: "Call Timeout"
        });
    }, timeout || 5000);
        
    return d.promise();
};

module.exports = {
    connect: function (url, query) {
        return new RPC(url, query);
    }
};
