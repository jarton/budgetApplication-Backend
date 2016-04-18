// dependencies
var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var ioStream = require('socket.io-stream');
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
				logger.error('oauth failed: ' + err)	
				login(err);
			}
			else {
				if (res.sub) { //google
					socket.client.username = res.sub;
					socket.client.name = data.name;
				}
				else {
					socket.client.username = res.id;	
					socket.client.name = data.name;
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
	//stores userinfo in redis, checks for sharerequest for that user
	postAuthenticate: function (socket, data) {

		var userData = {};
		// database user	
		if (data.email) { 
			socket.client.username = helpers.convertEmail(data.email);
			socket.client.name = data.name;
			userData.type = 'db';
			userData.name = data.name;
			userData.username = helpers.convertEmail(data.email);
			userData.email = helpers.convertEmail(data.email);
		}
		// oauth user
		else {
			userData.tpe = 'oatuh';
			userData.username = socket.client.username;
			userData.name = data.name;
		}

		userData.socketid = socket.id;
		userData.online= true;

		var keyname = socket.client.name + '|' + socket.client.username;

		redis.set(keyname, JSON.stringify(userData));

		logger.info('user: ' + userData.name + ' has logged in');

		// check for sharerequests
		redis.get('!req_' + keyname, function (err, result) {
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
		redis.get(socket.client.name + '|' + socket.client.username, function(err, res) {
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
		else {
			socket.emit('result', []);
		}
	});

	// get a single users info 
	socket.on('userInfo', function(data) {
		redis.get(data.name + '|' + data.username, function(err, res){
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

		var keyname = data.name + '|' + data.username;

		redis.get(keyname, function(err, result) {
			if (result) {
				result = JSON.parse(result);
				if (result.online === true) {
					socket.broadcast.to(result.socketid).emit('shareReq', shareObj);
				}
			}
			redis.set('!req_' + keyname, JSON.stringify(shareObj));
		});
	});

	// on response to share request
	socket.on('shareResp', function(data){
		var username = socket.client.username;
		var keyname = socket.client.name + '|' + socket.client.username;
		// if request exists and answer to share is yes
		redis.get('!req_' + keyname, function(err, result) {
			if ((data.accept === 'yes') && (result)) {

				result = JSON.parse(result);
				logger.info('user: ' + socket.client.name + ' has reponded to a share request from: ' + result.sender);
				redis.del('!req_' + keyname);

				// replicate using pouchdb as adapter
				var options = {
					live: true,
					doc_ids: [result.doc]
				};
				var source = new PouchDB(adminUser + result.sender);
				var target = new PouchDB(adminUser + username);

				source.replicate.to(target, options);
				source.replicate.from(target, options);
			}
		});
	});
});

server.listen(port)
