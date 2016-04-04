var bodyParser = require('body-parser');
var request = require('request');
var logger = require('./logger.js');
var auth = require('./auth.js');

module.exports = function(app) {

	const success = 200;
	const adminUser = 'http://admin:devonly@127.0.0.1:5984/';

	app.use(bodyParser.json()); // for parsing application/json

	app.use(function (req, res, next) {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, access-control-allow-origin, authorization");
		next();
	});

	function createUserDb(username, cb) {
		request.put({
			url: adminUser + username 
		}, function done () {
			logger.info('db created for user: ' + username);
			cb();
		});
	}

	// restful route for registration of a user registartion info as body param
	app.post('/register', function (req, res) {
		var user = req.body;

		var oauthCallback = function (oAuthRes) {
			if (oAuthRes.sub) {
				user.username = oAuthRes.sub;
			}
			else {
				user.username = oAuthRes.id;
			}
			logger.info('oauth user registration: ' + user.username);
			createUserDb(user.username, function() {
				res.sendStatus(success);
			});
		};

		// calls database and puts the user in the user doc
		if (user.method === 'oauth') {
			if (user.service === 'fb') {
				auth.facebookAuth(user.token, oauthCallback);
			}
			else {
				auth.googleAuth(user.token, oauthCallback);
			}
		}
		else {
			logger.info('db user registration: ' + user.username);
			request.put({
				url: adminUser + '_users/org.couchdb.user:'+ user.username,
				json: true,
				body: {
					name: user.username,
					type: "user",
					roles: [],
					password: user.password 
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
				createUserDb(user.username, function databaseCreated() {
					// restricts access to the new database to only the user
					request.put({
						url: adminUser + user.username + '/_security',
						json: true,
						body: {
							name: 'sec',
							admins: {
								names: [],
								roles: []
							},
							members: {
								names: [user.username],
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
		};
	});
}
