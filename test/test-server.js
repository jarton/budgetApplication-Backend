var chai = require('chai');
var should = chai.should();
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

	it("registration of a user should give back 200 status code", function (done) {
		request.post({
			url: 'http://localhost:6969/register',
			json: true,
			body: {
				method: 'db',
				username: 'testUser1',
				password: '1234'
			}
		},
		function(err, res, body){
			res.statusCode.should.equal(200);	
			done();
		});	
	});

	it("registering a user should put the user in the database", function (done) {
		request.post({
			url: 'http://localhost:6969/register',
			json: true,
			body: {
				method: 'db',
				username: 'testUser2',
				password: '1234'
			}
		},
		function(err, res, body){
			request.get({
				url: 'http://admin:devonly@localhost:5984/_users/org.couchdb.user:testUser2'
			},
			function(err, res, body){
				var parsed = JSON.parse(body);
				if (parsed.error) {
					should.fail();
					done();
				}
				else {
					parsed.name.should.equal('testUser2');
					done();
				}
			}
			);
		}
		);
	});

	it("one should be able to register with facebook token", function (done) {
		var testUser;
		request.get({
			url: 'https://graph.facebook.com/oauth/access_token?client_id=187079694982178&client_secret=82f6c63e28ce9bef1eedf02897b51c5b&grant_type=client_credentials'
		},
		function(err, res, body){
			request.get({
				url: 'https://graph.facebook.com/187079694982178/accounts/test-users?'+body
			},
			function(err, res, body){
				testUser = JSON.parse(body).data[1];
				request.post({
					url: 'http://localhost:6969/register',
					json: true,
					body: {
						method: 'oauth',
						service: 'fb',
						token: testUser.access_token
					}
				}, 
				function (err, res, body) {
					request.get({
						url: 'http://admin:devonly@localhost:5984/' + testUser.id
					},
					function(err, res, body){
						var parsed = JSON.parse(body);
						if (parsed.error) {
							should.fail();
							done();
						}
						else {
							parsed.db_name.should.equal(testUser.id);
							done();
						}
					});
				});
			});
		});
	});

	it("one should be able to login with facebook token", function (done) {
		var testUser;
		request.get({
			url: 'https://graph.facebook.com/oauth/access_token?client_id=187079694982178&client_secret=82f6c63e28ce9bef1eedf02897b51c5b&grant_type=client_credentials'
		},
		function(err, res, body){
			request.get({
				url: 'https://graph.facebook.com/187079694982178/accounts/test-users?'+body
			},
			function(err, res, body){
				testUser = JSON.parse(body).data[1];
				var client= io.connect('http://localhost:6969');

				client.emit('authentication', {
					token: testUser.access_token
				});

				client.on('authenticated', function() {
					client.disconnect();
					done();
				});
			});
		});
	});

	it("should accept correct login information", function (done) {
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
					url: 'http://testUser2:1234@localhost:5984/testUser2/test-category2'
				},
				function(err, res, body){
					if (err) {
						should.fail();
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
						url: 'http://testUser2:1234@localhost:5984/testUser2/testpull'
					},
					function(err, res, body){
						if (err) {
							should.fail();
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
		var receiver = io.connect('http://localhost:6969');

		receiver.emit('authentication', {
			username: "testUser2", password: "1234"
		});

		receiver.on('authenticated', function() {
			receiver.on('shareReq', function(shareObj) {
				shareObj.doc.should.equal('test-category');
				receiver.disconnect();
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

			var receiver = io.connect('http://localhost:6969');
			receiver.emit('authentication', {
				username: "testUser1", password: "1234"
			});
			receiver.on('authenticated', function() {
				receiver.on('shareReq', function(shareObj) {
					shareObj.doc.should.equal('test-category');
					receiver.disconnect();
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

			var receiver = io.connect('http://localhost:6969');
			receiver.emit('authentication', {
				username: "testUser1", password: "1234"
			});
			receiver.on('authenticated', function() {
				receiver.on('shareReq', function(shareObj) {
					receiver.emit('shareResp', {accept: 'yes'});
					setTimeout(function(){
						request.get({
							url: 'http://testUser1:1234@localhost:5984/testUser1/test-category2'
						},
						function(err, res, body){
							if (err) {
								should.fail();
								done();	
							}
							else {
								var parsed = JSON.parse(body);
								parsed.title.should.equal('user2');
								receiver.disconnect();
								done();
							}
						});	

					}, 1500);
				});
			});
		});

	});
});


