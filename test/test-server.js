var chai = require('chai');
var should = chai.should();
var request = require('request');
var io = require('socket.io-client');
var ioStream = require('socket.io-stream');
var PouchDB = require('pouchdb');

describe("server tests", function () {

	var server;
	var helpers;
	var jwt1;
	var jwt2;
	var testUser1db = new PouchDB('user1', {db: require('memdown')});
	var testUser2db = new PouchDB('user2', {db: require('memdown')});

	beforeEach(function (done) {
		server = require('../server');
		helpers = require('../helpers');
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

	it("convert email works", function() {
		var email = "test_me@internet.com";
		var res = "test_me$internet-com";
		email = helpers.convertEmail(email);
		email.should.equal(res);
	});

	it("registration of a user should give back 200 status code", function (done) {
		request.post({
			url: 'http://localhost:6969/register',
			json: true,
			body: {
				method: 'db',
				email: 'test@user1.no',
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
				email: 'test@user2.no',
				password: '1234'
			}
		},
		function(err, res, body){
			request.get({
				url: 'http://admin:devonly@localhost:5984/_users/org.couchdb.user:test$user2-no'
			},
			function(err, res, body){
				var parsed = JSON.parse(body);
				if (parsed.error) {
					should.fail();
					done();
				}
				else {
					parsed.name.should.equal('test$user2-no');
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
		request.post({
			url: 'http://localhost:6969/login',
			json: true,
			body: {
				name: 'test1',
				email: 'test@user1.no',
				password: '1234'
			}
		},
		function(err, res, body){
			body.token.should.exist;
			res.statusCode.should.equal(200);
			done();
		});
	});

	it("should not accecpt incorrect login information", function (done) {
		request.post({
			url: 'http://localhost:6969/login',
			json: true,
			body: {
				name: 'test1',
				email: 'test@user1.no',
				password: '34'
			}
		},
		function(err, res, body){
			body.should.not.have.property('token');
			res.statusCode.should.equal(202);
			done();
		});
	});

	it("should be able to connect with token", function (done) {
		request.post({
			url: 'http://localhost:6969/login',
			json: true,
			body: {
				name: 'test1',
				email: 'test@user1.no',
				password: '1234'
			}
		},
		function(err, res, body){
			jwt1 = body.token;	
			var client= io.connect('http://localhost:6969');

			client.emit('authentication', {
				token: jwt1, name: "test1", type: 'jwt'
			});

			client.on('authenticated', function() {
				client.disconnect();
				done();
			});
		});

	});

	it("should not accecpt incorrect connect information", function (done) {
		var client= io.connect('http://localhost:6969');

		client.emit('authentication', {
			token: 'invalidToken', name: "test1", type: 'jwt'
		});

		client.on('unauthorized', function(err){
			client.disconnect();
			done();
		})
	});

	it("should be able to search for users and get results", function(done) {
		var client= io.connect('http://localhost:6969');
		client.emit('authentication', {
			token: jwt1, name: "test1", type: 'jwt'
		});
		client.on('authenticated', function(err){
			client.emit("search", {search: 'test1'});

			client.on('result', function(res){
				res[0].should.equal('test1')
				done();
			});
		});
	});

	it("should be able to get info of a user", function(done) {
		request.post({
			url: 'http://localhost:6969/login',
			json: true,
			body: {
				name: 'test2',
				email: 'test@user2.no',
				password: '1234'
			}
		},
		function(err, res, body){
			jwt2 = body.token;
			var client= io.connect('http://localhost:6969');
			client.emit('authentication', {
				token: jwt2, name: "test2", type: 'jwt'
			});
			client.on('authenticated', function(err){
				client.emit('userInfo', {name: 'test2', username:'test$user2-no', });

				client.on('userInfo', function(res){
					res.username.should.equal('test$user2-no')
					done();
				});
			});
		});
	});

	it("should push local changes to central database", function (done) {
		this.timeout(3000);
		var client= io.connect('http://localhost:6969');

		client.emit('authentication', {
			token: jwt2, name: "test2", type: 'jwt'
		});
		client.on('authenticated', function(err){
			var stream = ioStream.createStream();
			ioStream(client).emit('push', stream);
			testUser2db.dump(stream).then(function(res) {
				setTimeout(function() {
					request.get({
						url: 'http://admin:devonly@localhost:5984/btest\$user2-no/test-category2'
					},
					function(err, res, body){
						var parsed = JSON.parse(body);
						if (parsed.error) {
							should.fail();
							done();	
						}
						else {
							parsed.title.should.equal('user2');
							client.disconnect();
							done();
						}
					});	
				}, 1500);
			});
		});
	});

	it("should pull central changes to local database", function (done) {
		this.timeout(3000);

		request.put('http://admin:devonly@localhost:5984/btest\$user2-no/testpull', 
					function(err, res, body){
						var client= io.connect('http://localhost:6969');

						client.emit('authentication', {
							token: jwt2, name: "test2", type: 'jwt'
						});
						client.on('authenticated', function(err){
							var stream = ioStream.createStream();
							ioStream(client).emit('pull', stream);
							testUser2db.load(stream).then(function() {
								testUser2db.get('testpull', function(err, doc) {
									doc.should.exist;
									done();
								});
							});
						});
					});

	});

	it("notify a user if another wants to share a budgetPost while they are online", function (done) {
		var sender = io.connect('http://localhost:6969');
		var receiver = io.connect('http://localhost:6969');

		receiver.emit('authentication', {
			token: jwt2, name: "test2", type: 'jwt'
		});

		receiver.on('authenticated', function() {
			receiver.on('shareReq', function(shareObj) {
				shareObj.doc.should.equal('test-category');
				receiver.disconnect();
				done();
			});
		});

		sender.emit('authentication', {
			token: jwt1, name: "test1", type: 'jwt'
		});
		sender.on('authenticated', function() {
			sender.emit('shareReq', {username:'test$user2-no', name: 'test2', docName:'test-category'});
			sender.disconnect();
		});
	});

	it("notify a user if another wants to share a budgetPost when they log in", function (done) {
		var sender = io.connect('http://localhost:6969');

		sender.emit('authentication', {
			token: jwt2, name: "test2", type: 'jwt'
		});

		sender.on('authenticated', function() {
			sender.emit('shareReq', {username:'test$user1-no', name: 'test1', docName:'test-category'});
			sender.disconnect();

			var receiver = io.connect('http://localhost:6969');
			receiver.emit('authentication', {
				token: jwt1, name: "test1", type: 'jwt'
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
			token: jwt2, name: "test2", type: 'jwt'
		});

		sender.on('authenticated', function() {
			sender.emit('shareReq', {username:'test$user1-no', name: 'test1', docName:'test-category2'});
			sender.disconnect();

			var receiver = io.connect('http://localhost:6969');

			receiver.emit('authentication', {
				token: jwt1, name: "test1", type: 'jwt'
			});
			receiver.on('authenticated', function() {
				receiver.on('shareReq', function(shareObj) {
					receiver.emit('shareResp', {accept: 'yes'});
					setTimeout(function(){
						request.get({
							url: 'http://admin:devonly@localhost:5984/btest\$user1-no/test-category2'
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


