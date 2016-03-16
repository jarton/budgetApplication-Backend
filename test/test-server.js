var chai = require('chai');
var chaiHttp = require('chai-http');
var should = chai.should();
var spawn = require('child_process').spawn;
var request = require('request');
var io = require('socket.io-client');
var ioStream = require('socket.io-stream');
var PouchDB = require('pouchdb');


describe("server tests", function () {

	var server;
	var testUser1db = new PouchDB('user1', {db: require('memdown')});
	var testUser2db = new PouchDB('user2', {db: require('memdown')});

	beforeEach(function (done) {
		server = require('../server');
		testUser1db.put({
			_id: 'test-category1',
			title: 'user1'
		}, function(err, response) {
			testUser2db.put({
				_id: 'test-category2',
				title: 'user2'
			}, function(err, response) {
				done();
			});

		});
	});

	it("regestering a user give back 200 status code", function (done) {
		request.get({
			url: 'http://testUser1:1234@localhost:6969/register',
		},
		function(err, res, body){
			res.statusCode.should.equal(200);	
			done();
		});	
	});

	it("regestering a user should put the uesr in the database", function (done) {
		request.get({
			url: 'http://testUser2:1234@localhost:6969/register',
		},
		function(err, res, body){
			request.get({
				url: 'http://admin:devonly@localhost:5984/_users/org.couchdb.user:testUser2'
			},
			function(err, res, body){
				if (err) {
					should.fail()
					done();	
				}
				else {
					var parsed = JSON.parse(body);
					parsed.name.should.equal('testUser2');
					done();
				}
			});
		});	
	});

	it("should accecpt correct login information", function (done) {
		var client= io.connect('http://localhost:6969');

		client.emit('authentication', {
			username: "testUser2", password: "1234"
		});

		client.on('authenticated', function() {
			client.disconnect();
			done();
		});
	});

	it("should not accecpt incorrect login information", function (done) {
		var client= io.connect('http://localhost:6969');

		client.emit('authentication', {
			username: "testUser2", password: "4"
		});
		client.on('unauthorized', function(err){
			client.disconnect();
			done();
		})
	});

	it("should push local changes to central database", function (done) {
		this.timeout(3000);
		var client= io.connect('http://localhost:6969');

		client.emit('authentication', {
			username: "testUser2", password: "1234"
		});
		client.on('authenticated', function(err){
			var stream = ioStream.createStream();
			ioStream(client).emit('push', stream);
			testUser2db.dump(stream);

			setTimeout(function() {
				request.get({
					url: 'http://testUser1:1234@localhost:5984/testUser1/test-category2',
				},
				function(err, res, body){
					if (err) {
						should.fail()
						done();	
					}
					else {
						var parsed = JSON.parse(body);
						parsed.title.should.equal('user2');
						client.disconnect();
						done();
					}
				});	
			}, 1500);
		});
	});

	it("should pull central changes to local database", function (done) {
		this.timeout(3000);

		request.put('http://testUser2:1234@localhost:5984/testUser2/testpull', function(err, res, body){
			var client= io.connect('http://localhost:6969');

			client.emit('authentication', {
				username: "testUser2", password: "1234"
			});
			client.on('authenticated', function(err){
				var stream = ioStream.createStream();
				ioStream(client).emit('pull', stream);
				testUser2db.load(stream);

				setTimeout(function() {
					request.get({
						url: 'http://testUser2:1234@localhost:5984/testUser2/testpull',
					},
					function(err, res, body){
						if (err) {
							should.fail()
							done();	
						}
						else {
							res.statusCode.should.equal(200);
							client.disconnect();
							done();
						}
					});	
				}, 1500);
			});
		});

	});

	it("notify a user if another wants to share a budgetPost while they are online", function (done) {
		var sender = io.connect('http://localhost:6969');
		var reciver = io.connect('http://localhost:6969');

		reciver.emit('authentication', {
			username: "testUser2", password: "1234"
		});

		reciver.on('authenticated', function() {
			reciver.on('shareReq', function(shareObj) {
				shareObj.doc.should.equal('test-category');
				reciver.disconnect();
				done();
			});
		});

		sender.emit('authentication', {
			username: "testUser1", password: "1234"
		});
		sender.on('authenticated', function() {
			sender.emit('shareReq', {userName:'testUser2', docName:'test-category'});
			sender.disconnect();
		});
	});

	it("notify a user if another wants to share a budgetPost when they log in", function (done) {
		var sender = io.connect('http://localhost:6969');

		sender.emit('authentication', {
			username: "testUser2", password: "1234"
		});

		sender.on('authenticated', function() {
			sender.emit('shareReq', {userName:'testUser1', docName:'test-category'});
			sender.disconnect();

			var reciver = io.connect('http://localhost:6969');
			reciver.emit('authentication', {
				username: "testUser1", password: "1234"
			});
			reciver.on('authenticated', function() {
				reciver.on('shareReq', function(shareObj) {
					shareObj.doc.should.equal('test-category');
					reciver.disconnect();
					done();
				});
			});
		});
	});

	it("server replicates document if respone was yes on share request", function (done) {
		this.timeout(3000);	

		var sender = io.connect('http://localhost:6969');

		sender.emit('authentication', {
			username: "testUser2", password: "1234"
		});

		sender.on('authenticated', function() {
			sender.emit('shareReq', {userName:'testUser1', docName:'test-category2'});
			sender.disconnect();

			var reciver = io.connect('http://localhost:6969');
			reciver.emit('authentication', {
				username: "testUser1", password: "1234"
			});
			reciver.on('authenticated', function() {
				reciver.on('shareReq', function(shareObj) {
					reciver.emit('shareResp', {accept: 'yes'});
					setTimeout(function(){
						request.get({
							url: 'http://testUser1:1234@localhost:5984/testUser1/test-category2',
						},
						function(err, res, body){
							if (err) {
								should.fail()
								done();	
							}
							else {
								var parsed = JSON.parse(body);
								parsed.title.should.equal('user2');
								reciver.disconnect();
								done();
							}
						});	

					}, 1500);
				});
			});
		});

	});
});


