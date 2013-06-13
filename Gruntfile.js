module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: {
    },
    uglify: {
      build: {
	files: {
	  "build.js": [
	    "src/angular.js",
	    "src/digest.js",
	    "src/base64.js",
            "src/app.js"
	  ]
	}
      }
    }
  });

  // Load the plugin that provides the "uglify" task.
  grunt.loadNpmTasks('grunt-contrib-uglify');

  // Default task(s).
  grunt.registerTask('default', ['uglify']);

};