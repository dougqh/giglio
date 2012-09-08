giglio
======

Simple JavaScript Framework for Micro-benchmarking - inspired by QUnit &amp; Caliper

module('my benchmark', {
  setup: function() {...},
  teardown: function() {...}
});

time('impl1', function(reps) {
  for ( var rep = 0; rep < reps; ++rep ) {
    //something to time
  }
});

time('impl2', function(reps) {
  ...
});

//...more modules...

var reps = 10000;
benchmark(reps);