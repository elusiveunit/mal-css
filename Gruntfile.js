module.exports = function(grunt) {
	'use strict';

	grunt.initConfig({

		sass: {
			options: {
				outputStyle: 'expanded'
			},
			cards: {
        files: {
          'css/material-cards.css': 'css/material-cards.scss'
        }
			}
		},

		cssmin: {
			cards: {
				files: {
          'css/material-cards.min.css': 'css/material-cards.css'
        }
			}
		},

		watch: {
			css: {
				files: ['css/**/*.scss'],
				tasks: ['sass', 'cssmin']
			}
		}

	});

	require('load-grunt-tasks')(grunt);

	grunt.registerTask('default', ['watch']);
	grunt.registerTask('css', ['sass', 'cssmin']);

};