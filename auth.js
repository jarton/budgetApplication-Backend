var request = require('request');
var crypto = require('crypto');
var logger = require('./logger.js');
var helpers = require('./helpers.js');
var appSecretFB = '82f6c63e28ce9bef1eedf02897b51c5b';
var appIdFB = '187079694982178';
var adminUser = 'http://admin:devonly@127.0.0.1:5984/';
var success = 200;

module.exports = {


	/**
	 * Calls facebook api to check if the acess token for the user is valid.
	 * uses callback with (err, res) format.
	 * @param {string} token users access token
	 * @param {function} callback function
	 * @returns {undefined} nothing
	 */
	facebookAuth: function(token, callback) {
		var hash = crypto.createHmac('sha256', appSecretFB)
		.update(token)
		.digest('hex');
		request.get({
			url: 'https://graph.facebook.com/v2.5/me?fields=id,name&access_token=' + token + '&appsecret_proof='+ hash.toString('hex')
		}, function (error, response) {
			var res = JSON.parse(response.body);
			logger.info('fb api call for user: ' + res.name);
			if (!error && response.statusCode === success) {
				return callback(undefined, res)
			}
			else {
				return callback(res);
			}
		});
	},

	/**
	 * Calls google api to check if the id token is valid.
	 * uses callback with (err, res) format.
	 * @param {string} token users access token
	 * @param {function} callback function
	 * @returns {undefined} nothing
	 */
	googleAuth: function(token, callback) {
		request.get({
			url: 'https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=' + token
		}, function (error, response) {
			var res = JSON.parse(response.body);
			logger.info('google api call for user: ' + res.sub);
			if (!error && response.statusCode === success) {
				return callback(undefined, res)
			}
			else {
				return callback(res);
			}
		});
	},


	/**
	 * Calls couchdb server to check the credentials of the user.
	 * uses callback with (err, res) format.
	 * @param {string} email users email
	 * @param {string} pwd users password
	 * @param {function} callback function
	 * @returns {undefined} nothing
	 */
	dbAuth: function(email, pwd, callback) {
		// login request
		
		var uname = helpers.convertEmail(email);
		
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
			logger.info('db auth for user: ' + uname);
			if (!error && response.statusCode === success) {
				return callback(undefined);
			}
			else {
				logger.error(response.body);
				return callback("User not found");
			}
		});
	},
	getLongToken: function(token, callback) {
		//var hash = crypto.createHmac('sha256', appSecretFB)
		//.update(token)
		//.digest('hex');
		request.get({
			//url: 'https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&amp;client_id='+app+'&amp;client_secret='+ hash.toString('hex')+ '&amp;fb_exchange_token='+token
			url: 'https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&amp;client_id='+ appIdFB +'&amp;client_secret='+ appSecretFB + '&amp;fb_exchange_token='+token
		}, function (error, response) {
			var res = JSON.parse(response.body);
			logger.info('exhange token for : ' + JSON.stringify(res));
			if (!error && response.statusCode === success) {
				return callback(undefined, res)
			}
			else {
				return callback(res);
			}
		});
	}
};
