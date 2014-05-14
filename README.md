http-jsonrpc
============

http-jsonrpc is a library implementing JSON-RPC 2.0 over HTTP protocol.

Examples
========

````javascript
var RPC = require('http-jsonrpc');

var client = RPC.connect('http://path/to/rpc', {q:"xxx"});

client
.call('method', [p1,p2,p3])
.done(function(ret){
}, function(err){
});

// or later connect
var client = new RPC();
client.call('method', [p1,p2,p3]).done(function(ret){}, function(err){});
client.connect('http://path/to/rpc', {q:"xxx"});

var server = rpc.server();
server.process(request);

var http = require('http');
http.createServer(function(req, res){
    server.process(req, res);
}).listen(8080);

````