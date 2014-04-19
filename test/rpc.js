var Winston = require('winston');

var httpRPC = require('../');
var assert = require("assert");

describe("JSON RPC over HTTP:", function(){

    var server = httpRPC.server();
    var http = require('http');
    http.createServer(function(req, res){
        server.process(req, res);
    }).listen(8080);

    var client = httpRPC.connect('http://localhost:8080/api');

    it("should be called", function(done) {

        server.calling("foo", function(params) {
            assert.equal(params.foo, "bar");
            return params.foo;
        });

        client
        .call("foo", {foo:"bar"})
        .done(function(ret){
            assert.equal(ret, "bar");
            done();
        }, function(err) {
            console.log(2);
            done();
        });

    })

});