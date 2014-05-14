require('blanket')({
    pattern: function (filename) {
        return !/node_modules/.test(filename);
    }
});

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
        }, done);

    })

    it("should catch Exception", function(done) {

        server.calling("foo", function(params) {
            throw new server.Exception("mocha", 9628);
        });

        client
        .call("foo", {foo:"bar"})
        .done(done, function(err) {
            assert.equal(err.message, "mocha");
            assert.equal(err.code, 9628);
            done();
        });

    })

});


describe("Later binding", function(){

    var server = new httpRPC();
    
    var http = require('http');
    http.createServer(function(req, res){
        server.process(req, res);
    }).listen(8088);

    var client = new httpRPC();
    
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
        }, done);

    })

    it("should catch Exception", function(done) {

        server.calling("foo", function(params) {
            throw new server.Exception("mocha", 9628);
        });

        client
        .call("foo", {foo:"bar"})
        .done(done, function(err) {
            assert.equal(err.message, "mocha");
            assert.equal(err.code, 9628);
            done();
        });

    })

    client.connect('http://localhost:8088/api');
});