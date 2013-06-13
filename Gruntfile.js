module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: {
    },
    uglify: {
      options: {
	report: 'gzip'
      },
      build: {
	files: {
	  "build.js": [
            "app.js",
	    "base64.js"
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