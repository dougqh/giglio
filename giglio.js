/**
 * Giglio is a small micro-benchmark framework for JavaScript inspired 
 * by QUnit and Caliper.
 *
 * module('foo', {
 *   startup: function() {...},
 *   teardown: function() {...}
 * });
 * time('foo', function(reps) {...});
 */

(function(window) {
    'use strict';

    var Deferred = (function() {
        var Deferred = function(result) {
            if ( typeof result !== 'undefined' ) {
                this.result = result;
            } else {
                this._callbacks = [];
            }
        };
        Deferred.prototype.success = function(fn) {
            if ( typeof this.result !== 'undefined' ) {
                fn(this);
            } else {
                this._callbacks.push(fn);
            }
        };
        Deferred.prototype.set = function(result) {
            this.result = result;
            
            if ( this._callbacks ) {
                for ( var i = 0, len = this._callbacks.length; i < len; ++i ) {
                    var callback = this._callbacks[i];
                    callback(this);
                }
            }
        };
        Deferred.prototype.done = function() {
            this.set(null);
        };
        return Deferred;
    })();
    
    var consoleFrontend = (function() {
        return {
            module: function(module) {
                console.log('Benchmarking ' + module.name + '...');
            },
            
            startTime: function(module, entry) {
                console.time(entry.name);
            },
            
            endTime: function(module, entry) {
                console.timeEnd(entry.name);
            }
        };
    })();
    
    var timerBackend = (function() {        
        var schedule = function(fn) {
            window.setTimeout(fn, 0);
        };
        
        var timerBackend = {
            benchmark: function(frontend, module, reps) {
                frontend.module(module);
                
                var remainingEntries = module.funcEntries.slice(0, module.funcEntries.length);
                
                var timeNext = function() {
                    if ( ! remainingEntries.length ) {
                        return;
                    }
                    
                    var entry = remainingEntries.shift();
                    
                    var deferred = timerBackend.time(frontend, module, entry, reps);
                    deferred.success(timeNext);
                };
                schedule(timeNext);
            },
            
            time: function(frontend, module, entry, reps) {
                var deferred = new Deferred();
                
                var timeIt = function() {
                    var context = {};
                    
                    module.lifecycle.setup.call(context);
                    try {
                        frontend.startTime(module, entry);
                        
                        entry.func.call(context, reps);
                    
                        frontend.endTime(module, entry);
                        
                        deferred.done();
                    } finally {
                        module.lifecycle.teardown.call(context);
                    }
                };
                
                schedule(timeIt);
                return deferred;
            }
        };
        
        return timerBackend;
    })();
    
    var giglio = (function() {
        var config = {
            frontend: consoleFrontend,
            backend: timerBackend
        };
    
        var giglio = {};
        
        giglio.Deferred = Deferred;
        giglio.consoleFrontend = consoleFrontend;
        giglio.timerBackend = timerBackend;
        
        var module;
        
        var nop = function() {};
        
        giglio.module = function(name, lifecycle) {
            module = {
                name: name,
                lifecycle: {
                    setup: lifecycle.setup || nop,
                    teardown: lifecycle.teardown || nop
                },
                funcEntries: []
            };
        };
        
        giglio.time = function(name, fn) {
            if ( ! module ) {
                giglio.module('Benchmark');
            }
            
            module.funcEntries.push({name: name, func: fn});
        };
        
        giglio.benchmark = function(reps) {
            config.backend.benchmark(config.frontend, module, reps);
        };
        
        return giglio;
    })();
    
    window.giglio = giglio;
    window.module = window.module || giglio.module;
    window.time = window.time || giglio.time;
    window.benchmark = window.benchmark || giglio.benchmark;
})(window);