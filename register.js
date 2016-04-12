var bodyParser = require('body-parser');
var request = require('request');
var logger = require('./logger.js');
var auth = require('./auth.js');

/**
 * Sets up express app, and routing.
 * @param {object} app the express app object.
 */
module.exports = function(app) {

	const success = 200;
	const forbidden = 403;
	const adminUser = 'http://admin:devonly@127.0.0.1:5984/';

	app.use(bodyParser.json()); // for parsing application/json

	app.use(function (req, res, next) {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, access-control-allow-origin, authorization");
		next();
	});


	/**
	* creates a database for the user.
	* @param {string} username the name of the database.
	* @param {function} cb the fucntion to call when db has been created.
	*/
	function createUserDb(username, cb) {
		request.put({
			url: adminUser + username 
		}, function done () {
			logger.info('db created for user: ' + username);
			cb();
		});
	}

	/**
	* restful route for regestering a user.
	* does different things depending on if the user wants
	* to register with the couchdb database or via facebook/google.
	* If user wants database user the function creates a user, a database
	* and sets the permissions to that database.
	* If facebook or google their api gets called and the user is verified and then
	* a database for thats user gets created.
	* @param {object} req the http request
	* @param {object} res the result to send back
	*/
	app.post('/register', function (req, res) {
		var user = req.body;

		var oauthCallback = function (err, oAuthRes) {
			if (err) {
				logger.error('error oatuh call: ' +  err)	
				res.sendStatus(forbidden);
			}
			else { 
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
			}
		};

		// uses third party verification if user details.
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
