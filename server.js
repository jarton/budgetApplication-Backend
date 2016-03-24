// dependencies
var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var ioStream = require('socket.io-stream');
var request = require('request');
var basicAuth = require('basic-auth');
var PouchDB = require('pouchdb');
var replicationStream = require('pouchdb-replication-stream');

// make backend server able to replicate to/from stream
PouchDB.plugin(replicationStream.plugin);
PouchDB.adapter('writableStream', replicationStream.adapters.writableStream);

// login and url for backend server with admin credentials
var adminUser = 'http://admin:devonly@127.0.0.1:5984/';

// variables used for server
var port = 6969;
var success = 200;
var shareReq = {};
var users = {};

// calls db and uses its authentiaction via http locally for logging in
function dbAuth(uname, pwd, callback) {
	// login request
	request.post({
		url: adminUser+ '_session',
		form: {
			name: uname,
			password: pwd 
		},
		headers: [
			{
				name: 'content-type',
				value: 'application/x-www-form-urlencoded'
			}
		]
		// callback from login request checks response to see if sucessful
	}, function (error, response) {
		if (!error && response.statusCode === success) {
			return callback(undefined);
		}
		else {
			return callback(new Error("User not found"));
		}
	});
}

// socket.io auth module uses above function for login
require('socketio-auth')(io, {
	authenticate: function (socket, data, callback) {
		var username = data.username;
		var password = data.password;
		dbAuth(username, password, function(err) {
			if (err) {
				return callback(new Error("User not found"));
			}
			else {
				return callback(null, true);
			}
		});
	},
	// after login add user to list of users
	postAuthenticate: function (socket, data) {
		users[data.username] = socket.id;
		socket.client.username = data.username;
		// if user logs in and has a pending share request this will send it
		for(var name in shareReq){
			if (name === data.username) {
				socket.emit('shareReq', shareReq[name]);
			}
		}

	}
});

// restful route for registration of a user, uses basic auth header
app.get('/register', function (req, res) {
	var user = basicAuth(req); 

	// calls database and puts the user in the user doc
	request.put({
		url: adminUser + '_users/org.couchdb.user:'+ user.name,
		json: true,
		body: {
			name: user.name,
			type: "user",
			roles: [],
			password: user.pass 
		},
		headers: [
			{
				name: 'accept',
				value: 'application/json'
			},
			{
				name: 'content-type',
				value: 'application/json'
			}
		]
	}, function userCreated() {
		// creates a database with the users name
		request.put({
			url: adminUser + user.name 
		}, function databaseCreated() {
			// restricts access to the new database to only the user
			request.put({
				url: adminUser + user.name + '/_security',
				json: true,
				body: {
					name: 'sec',
					admins: {
						names: [],
						roles: []
					},
					members: {
						names: [user.name],
						roles: []
					}
				},
				headers: [
					{
						name: 'accept',
						value: 'application/json'
					},
					{
						name: 'content-type',
						value: 'application/json'
					}
				]
			}, function dbAccessCallback() {
				res.sendStatus(success);
			});
		});
	});
});

// socket connection
io.on('connection', function(socket) {

	// remove user when socket closes
	socket.on('disconnect', function () {
		delete users[socket.client.username];
	});

	// load changes from client database
	ioStream(socket).on('push', function(stream) {
		var db = new PouchDB(adminUser + socket.client.username);
		db.load(stream);
	});

	// send changes on server database to client
	ioStream(socket).on('pull', function(stream) {
		var db = new PouchDB(adminUser + socket.client.username);
		db.dump(stream);
	});

	// share budget docuemnt request
	socket.on('shareReq', function(data){
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
		};
	});

	// on response to share request
	socket.on('shareResp', function(data){
		var username = socket.client.username;
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

server.listen(port);
