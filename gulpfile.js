var gulp = require('gulp');
var exit = require('gulp-exit');
var mocha = require('gulp-mocha');
var istanbul = require('gulp-istanbul');
var spawn = require('child_process').spawn;
var eslint = require('gulp-eslint');

var pouchserver;

//sets up coverage repoting for tests
gulp.task('pre-test', function () {
	return gulp.src(['*.js'])
	// Covering files
	.pipe(istanbul())
	// Force `require` to return covered files
	.pipe(istanbul.hookRequire());
});

//starts a in memory db for testing backend locally
gulp.task('startdb', function(callback) {
	pouchserver = spawn('node', ['./node_modules/pouchdb-server/bin/pouchdb-server', '-m'], {stdio: ['ignore', 'ignore', 'ignore']});
	setTimeout(function () {
		callback(undefined);
	}, 1000);
});

//runs unit tests for backend
gulp.task('test', ['pre-test', 'startdb'], function () {
	return gulp.src('test/*.js', {read: false})
	.pipe(mocha({reporter: 'nyan'}))
	.pipe(istanbul.writeReports())
	.pipe(exit());
});

// lints js files with eslint rules
gulp.task('lint', function(){
	gulp.src('server.js')
	.pipe(eslint())
	.pipe(eslint.format())
	.pipe(eslint.failAfterError());
});

// git hook runs this task witch tests and lints files
gulp.task('pre-commit', ['test','lint'], function(){

});
