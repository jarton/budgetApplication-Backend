module.exports = {
	convertEmail: function(email) {
		email = email.replace('.', "-");
		email = email.replace('@', "$");
		return email;
	}
};
