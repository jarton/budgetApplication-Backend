// dependencies
var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var ioStream = require('socket.io-stream');
var request = require('request');
var PouchDB = require('pouchdb');
var replicationStream = require('pouchdb-replication-stream');
var Redis = require('ioredis')

var logger = require('./logger.js');
require('./register.js')(app);
var auth = require('./auth.js');
var helpers = require('./helpers.js');

// make backend server able to replicate to/from stream
PouchDB.plugin(replicationStream.plugin);
PouchDB.adapter('writableStream', replicationStream.adapters.writableStream);


// login and url for backend server with admin credentials
var adminUser = 'http://admin:devonly@127.0.0.1:5984/';

// variables used for server
var port = 6969;
var googleTokenLength = 1000;

var redis = new Redis();

// socket.io auth module uses above function for login
require('socketio-auth')(io, {
	authenticate: function (socket, data, callback) {

		function login(err) {
			if (err) {
				return callback(new Error("User not found"));
			}
			else {
				return callback(null, true);
			}
		}

		function oauthResponse(err, res) {
			if (err) {
				logger.warn('oauth failed: ' + err)	
				login(err);
			}
			else {
				if (res.sub) { //google
					socket.client.username = res.sub;
					socket.client.name = res.name;
				}
				else {
					socket.client.username = res.id;	
					socket.client.name = res.name;
				}
				login(undefined);
			}
		}

		if (data.token) {
			if (data.token.length > googleTokenLength) {
				auth.googleAuth(data.token, oauthResponse);
			}
			else {
				auth.facebookAuth(data.token, oauthResponse);
			}
		}
		else {
			auth.dbAuth(data.email, data.password, login);
		}
	},
	// after login add user to list of users
	postAuthenticate: function (socket, data) {

		var userData = {};
		if (data.email) { //dbauth was used
			socket.client.username = helpers.convertEmail(data.email);
			socket.client.name = data.email;
			userData.type = 'db';
			userData.name = data.email;
			userData.username = helpers.convertEmail(data.email);
		}
		else {
			userData.tpe = 'oatuh';
			userData.username = socket.client.username;
			userData.name = socket.client.name;
		}

		userData.socketid = socket.id;
		userData.online= true;
		redis.set(socket.client.name , JSON.stringify(userData));

		logger.info('user: ' + userData.name + ' has logged in');

		redis.get('!req_' + userData.username, function (err, result) {
			if (result) {
				result = JSON.parse(result);
				socket.emit('shareReq', result);
			};
		});
	}
});

// socket connection
io.on('connection', function(socket) {

	// remove user when socket closes
	socket.on('disconnect', function () {
		logger.info('user: ' + socket.client.name + ' has logged out');
		redis.get(socket.client.name, function(err, res) {
			if (res) {
				res = JSON.parse(res);
				res.online = false;
				redis.set(res.name, JSON.stringify(res));
			}
		});
	});

	// search for username containing input from client
	socket.on('search', function(data) {
		if (!(data.search.startsWith('!'))) {

			var keys = []

			var stream = redis.scanStream({
				match: data.search + '*',
				count: 100
			});

			stream.on('data', function (resKeys) {
				for (var i = 0; i < resKeys.length; i++){
					keys.push(resKeys[i]);
				}
			});

			stream.on('end', function() {
				socket.emit('result', keys);
			});
		}
	});

	// get a single users info 
	socket.on('userInfo', function(data) {
		redis.get(data.name, function(err, res){
			if (res){
				socket.emit('userInfo', JSON.parse(res));
			}
		});
	});

	// load changes from client database
	ioStream(socket).on('push', function(stream) {
		logger.info('user: ' + socket.client.name + ' is pushing db');
		var db = new PouchDB(adminUser + socket.client.username);
		db.load(stream);
	});

	// send changes on server database to client
	ioStream(socket).on('pull', function(stream) {
		logger.info('user: ' + socket.client.name + ' is pulling db');
		var db = new PouchDB(adminUser + socket.client.username);
		db.dump(stream);
	});

	// share budget docuemnt request
	socket.on('shareReq', function(data){
		logger.info('user: ' + socket.client.name + ' is sending a share request to: ' + data.username);
		var shareObj = {
			doc: data.docName,
			sender: socket.client.username 
		};

		redis.get(data.username, function(err, result) {
			if (result) {
				result = JSON.parse(result);
				if (result.online === true) {
					socket.broadcast.to(result.socketid).emit('shareReq', shareObj);
				}
			}
			redis.set('!req_' + data.username, JSON.stringify(shareObj));
		});
	});

	// on response to share request
	socket.on('shareResp', function(data){
		var username = socket.client.username;
		// if request exists and answer to share is yes
		redis.get('!req_' + username, function(err, result) {
			if ((data.accept === 'yes') && (result)) {

				result = JSON.parse(result);
				logger.info('user: ' + socket.client.name + ' has reponded to a share request from: ' + result.sender);
				redis.del('!req_' + username);

				// tell database to replicate selected doc between users
				request.post({
					url: adminUser+ '_replicate',
					json: true,
					body: {
						source: adminUser+result.sender,
						target: adminUser+username,
						doc_ids: result.doc,
						continuous: true
					},
					headers: [
						{
							name: 'content-type',
							value: 'application/json'
						}
					]
				}); 
			}
		});
	});
});

server.listen(port)
