// dependencies
var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var ioStream = require('socket.io-stream');
var request = require('request');
var PouchDB = require('pouchdb');
var replicationStream = require('pouchdb-replication-stream');

var logger = require('./logger.js');
require('./register.js')(app);
var auth = require('./auth.js');

// make backend server able to replicate to/from stream
PouchDB.plugin(replicationStream.plugin);
PouchDB.adapter('writableStream', replicationStream.adapters.writableStream);


// login and url for backend server with admin credentials
var adminUser = 'http://admin:devonly@127.0.0.1:5984/';

// variables used for server
var port = 6969;
var shareReq = {};
var users = {};
var googleTokenLength = 1000;

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
			auth.dbAuth(data.username, data.password, login);
		}
	},
	// after login add user to list of users
	postAuthenticate: function (socket, data) {
		if (data.username) { //dbauth was used
			socket.client.name = data.username;
			socket.client.username = data.username;
		}
		logger.info('user: ' + socket.client.name + ' has logged in');
		users[socket.client.name] = socket.id;
		// if user logs in and has a pending share request this will send it
		for(var name in shareReq){
			if (name === data.username) {
				socket.emit('shareReq', shareReq[name]);
			}
		}
	}
});

// socket connection
io.on('connection', function(socket) {

	// remove user when socket closes
	socket.on('disconnect', function () {
		logger.info('user: ' + socket.client.name + ' has logged out');
		delete users[socket.client.name];
	});

	// load changes from client database
	ioStream(socket).on('push', function(stream) {
		logger.info('user: ' + socket.client.username+ ' is pushing db');
		var db = new PouchDB(adminUser + socket.client.username);
		db.load(stream);
	});

	// send changes on server database to client
	ioStream(socket).on('pull', function(stream) {
		logger.info('user: ' + socket.client.username+ ' is pulling db');
		var db = new PouchDB(adminUser + socket.client.username);
		db.dump(stream);
	});

	// share budget docuemnt request
	socket.on('shareReq', function(data){
		logger.info('user: ' + socket.client.username+ ' is sending a share request to: ' + data.userName);
		var shareObj = {
			doc: data.docName,
			sender: socket.client.username 
		};
		var found = false;

		//check if user is online and send request if that is the case
		for(var name in users){
			if (name === data.userName) {
				socket.broadcast.to(users[name]).emit('shareReq', shareObj);
				found = true;
			}
		}

		// else store for later
		if (!found) {
			shareReq[data.userName] = shareObj;
		}
	});

	// on response to share request
	socket.on('shareResp', function(data){
		var username = socket.client.username;
		logger.info('user: ' + socket.client.username 
					+ ' has reponded to a share request from: ' + shareReq[username].sender);
					// if request exists and answer to share is yes
					if ((data.accept === 'yes') && (shareReq[username] !== undefined)) {
						// tell database to replicate selected doc between users
						request.post({
							url: adminUser+ '_replicate',
							json: true,
							body: {
								source: adminUser+shareReq[username].sender,
								target: adminUser+username,
								doc_ids: [shareReq[username].doc],
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

server.listen(port)
