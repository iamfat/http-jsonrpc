http-jsonrpc
============

http-jsonrpc is a library implementing JSON-RPC 2.0 over HTTP protocol.

Examples
========

````javascript
var rpc = require('http-jsonrpc').connect('http://path/to/rpc');
rpc
.call('method', [p1,p2,p3])
.done(function(ret){
})
.fail(function(err){
})
.always(function(){
});

````