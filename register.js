var bodyParser = require('body-parser');
var request = require('request');
var PouchDB = require('pouchdb');
var logger = require('./logger.js');
var auth = require('./auth.js');
var helpers = require('./helpers.js');

/**
 * Sets up express app, and routing.
 * @param {object} app the express app object.
 */
module.exports = function(app) {

	const success = 200;
	const forbidden = 403;
	const adminUser = 'http://admin:devonly@127.0.0.1:5984/';
	const dbNamePadding = 'b';

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
		var db = new PouchDB(adminUser + dbNamePadding + username, {
			skip_setup: true	
		});
		db.info(function(err, info) {
			if (err) {
				if (err.message === 'missing') {
					db = new PouchDB(adminUser + dbNamePadding + username);
					logger.info('db created for user: ' + username);
					cb(undefined);
				}
				else {
					logger.error('db error: ' + err.message);
					cb(username + 'error creating db'); 
				}
			}
			else {
				cb(username + ' is already registered');
			}
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
				res.status(forbidden).send('OAUTH FAIL');
			}
			else { 
				if (oAuthRes.sub) {
					user.username = oAuthRes.sub;
				}
				else {
					user.username = oAuthRes.id;
				}
				logger.info('oauth user registration: ' + user.username);
				createUserDb(user.username, function(err) {
					if (err) {
						logger.error(err);
						res.status(forbidden).send('ALREADY REGISTERED')
					}
					else {
						res.status(success).send('OK')
					}
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
			logger.info('db user registration: ' + user.email);
			user.username = helpers.convertEmail(user.email);

			var db = new PouchDB(adminUser + '_users');
			db.put({
					_id: 'org.couchdb.user:' + user.username,
					name: user.username,
					type: "user",
					roles: [],
					password: user.password 
			}, function(err, response) {
				if (err) {
					logger.error(err);
					res.status(forbidden).send('USER EXISTS');
				}
				else {
					createUserDb(user.username, function databaseCreated(err) {
						if (err) {
							logger.error(err);
							res.status(forbidden).send('USER EXISTS');
						}
						else {
							res.status(success).send('OK')
						}
					});
				}
			});
		};
	});
}
