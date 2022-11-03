const gulp = require('gulp');
// gulp.src(['./src/index.js']);
const babel = require('gulp-babel');
const include = require('gulp-include');
gulp.task('default', function(){    
    return gulp.src(['./src/index.js'])   
    .pipe(babel({
            presets: ['env']
    })) 
    .pipe(include())
    .pipe(gulp.dest('dist')); 
});