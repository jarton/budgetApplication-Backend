var request = require('request');
var crypto = require('crypto');
var logger = require('./logger.js');
var appSecretFB = '82f6c63e28ce9bef1eedf02897b51c5b';
var adminUser = 'http://admin:devonly@127.0.0.1:5984/';
var success = 200;

module.exports = {


	facebookAuth: function(token, callback) {
		var hash = crypto.createHmac('sha256', appSecretFB)
		.update(token)
		.digest('hex');
		request.get({
			url: 'https://graph.facebook.com/v2.5/me?fields=id,name&access_token=' + token + '&appsecret_proof='+ hash.toString('hex')
		}, function (error, response) {
			logger.info('fb api call for user: ' + response.body.name);
			if (!error && response.statusCode === success) {
				return callback(response)
			}
			else {
				return callback(response.statusCode);
			}
		});
	},

	googleAuth: function(token, callback) {
		request.get({
			url: 'https://www.googleapis.com/oauth2/v3/tokeninfo?id_token='  + token
		}, function (error, response) {
			var res = JSON.parse(response.body);
			logger.info('google api call for user: ' + res.sub);
			if (!error && response.statusCode === success) {
				return callback(res)
			}
			else {
				return callback('fail');
			}
		});
	},

	dbAuth: function(uname, pwd, callback) {
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
			logger.info('db auth for user: ' + uname + ' : ' + response.statusCode);
			if (!error && response.statusCode === success) {
				return callback(undefined);
			}
			else {
				return callback(new Error("User not found"));
			}
		});
	}
}
