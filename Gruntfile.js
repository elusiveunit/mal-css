module.exports = function(grunt) {
	'use strict';

	grunt.initConfig({

		sass: {
			options: {
				outputStyle: 'expanded'
			},
			style: {
        files: {
          'css/style.css': 'css/style.scss'
        }
			}
		},

		cssmin: {
			style: {
				files: {
          'css/style.min.css': 'css/style.css'
        }
			}
		},

		watch: {
			css: {
				files: ['css/**/*.scss'],
				tasks: ['sass']
			}
		}

	});

	require('load-grunt-tasks')(grunt);

	grunt.registerTask('default', ['watch']);

};