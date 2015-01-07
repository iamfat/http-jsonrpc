require('blanket')({
    pattern: function (filename) {
        return !/node_modules/.test(filename);
    }
});

var httpRPC = require('../');
var assert = require("assert");

describe("throttleing on JSON RPC over HTTP:", function(){

    var server = httpRPC.server();
    var http = require('http');
    http.createServer(function(req, res){
        server.process(req, res);
    }).listen(8080);

    var client = httpRPC.connect('http://localhost:8080/api');
    client.maxConcurrency = 3;
    
    var concurr = 0;
    var called = 0;
    server.calling("foo", function(params) {
        concurr++;
        assert(concurr <= client.maxConcurrency);
        return function(done) {
           setTimeout(function(){
               done(null, params.foo);
           }, 200);  
        }
    });
    
    var max = 5;
    it("should be called", function(done) {

        var times = max;
        while (times--) {
            client
            .call("foo", {foo: times})
            .done(function(ret){
                concurr--;
                called++;
                if (called == max) done();
            }, function(err){
                concurr--;
                called++;
                if (called == max) done();
            });
        }

    })

});
