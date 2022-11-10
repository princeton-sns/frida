// const gulp = require('gulp');
import gulp from 'gulp';
// gulp.src(['./src/index.js']);
// const babel = require('gulp-babel');
import babel from 'gulp-babel';
// const include = require('gulp-include');
import include from 'gulp-include';
gulp.task('default', function(){    
    return gulp.src(['./src/index.js'])   
    .pipe(babel({
            presets: ['@vue/cli-plugin-babel/preset']
    })) 
    .pipe(include())
    .pipe(gulp.dest('dist')); 
});