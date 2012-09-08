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

(function(window, undefined) {
    'use strict';
    
    /**
     * A simple implementation of a Deferred (similar to jQuery's)
     * Giglio Executor's return Deferred-s to abstract the actual 
     * scheduling mechanism.
     */
    var Deferred = function(result) {
        var self = {
            done: false,
            callbacks: []
        };
        
        var makeEvent = function() {
            return {
                result: self.result,
                exception: self.exception
            };
        };
        var markDone = function() {
            self.done = true;
            
            var event = makeEvent();
            for ( var i = 0, len = self.callbacks.length; i < len; ++i ) {
                try {
                    self.callbacks[i].call(null, event);
                } catch ( e ) {
                    console.log('exception in deferred callback', e);
                }
            }
            delete self.callbacks;
        };
        
        var deferred = {};
        deferred.result = function(result) {
            self.result = result;
            markDone();
        };
        deferred.exception = function(exception) {
            self.exception = exception;
            markDone();
        };
        deferred.done = function() {
            markDone();
        };
        deferred.capture = function(fn, thisObj, args) {
            thisObj = thisObj || null;
            args = args || [];
            
            try {
                this.result(fn.apply(thisObj, args));
            } catch ( e ) {
                this.exception(e);
            }
        };
        deferred.always = function(callback) {
            if ( self.done ) {
                callback.call(null, makeEvent());
            } else {
                self.callbacks.push(callback);
            }
        };
        return deferred;
    };
    
    /**
     * Frontend that writes output to the console
     */    
    var consoleFrontend = (function() {
        var frontend = {};
        frontend.id = 'console';
        
        frontend.moduleStart = function(module) {
            console.log('Benchmarking ' + module.name + '...');
        };
        frontend.functionStart = function(module, funcEntry) {
            console.log('Running ' + funcEntry.name + '...');
        };
        frontend.functionSuccess = function(module, funcEntry, timeMs) {
            console.log(module.name + ' ' + funcEntry.name + ' ' + timeMs + 'ms');
        };
        frontend.functionFailure = function(module, funcEntry, exception) {
            console.log(module.name + ' ' + funcEntry.name, exception);
        };
        frontend.moduleEnd = function(module) {
        };
        
        return frontend;
    })();
    
    
    /**
     * Timer that uses built-in console.time and timeEnd functions.
     * (not supported in all browsers)
     * Does not return a value so it is not compatible with most frontends.
     */
    var consoleTimer = (function() {
        var timer = {};
        timer.id = 'console';
        
        timer.timeStart = function(module, entry) {
            console.time(module.name + ' - ' + entry.name);
        };
        timer.timeEnd = function(module, entry) {
            console.timeEnd(module.name + ' - ' + entry.name);
        };
        
        return timer;
    })();
    
    
    /**
     * Executor that uses window.setTimeout to schedule timing runs
     */
    var timeoutExecutor = (function() {
        var executor = {};
        executor.id = 'timeout';
        
        executor.schedule = function(fn, thisObj, args) {
            var deferred = Deferred();
            window.setTimeout(function() {
                deferred.capture(fn, thisObj, args);
            }, 0);
            return deferred;
        };
        
        return executor;
    })();
    
    /**
     * Immediate executor that runs right now
     */
    var immediateExecutor = (function() {
        var executor = {};
        executor.id = 'immediate';
        
        executor.schedule = function(fn, thisObj, args) {
            fn.apply(thisObj, args);
        };
        
        return executor;
    })();
    
    
    /**
     * Engine that drives the running of the time functions
     */
        var engine = (function() {
        var process = function(executor, array, deferredFn) {
            var overallDeferred = Deferred();
            
            var queue = array.slice(0, array.length);
            
            var next, scheduleNext;
            scheduleNext = function() {
                if ( queue.length === 0 ) {
                    overallDeferred.done();
                } else {
                    executor.schedule(next);
                }
            };
            next = function(deferred) {
                var deferred = deferredFn(queue.shift());
                deferred.always(scheduleNext);
            };
            scheduleNext();
            
            return overallDeferred;
        };
        
        var engine = {};
        
        engine.timeAll = function(config, reps, modules) {
            return process(config.executor, modules, function(module) {
                return engine.timeModule(config, reps, module);
            });
        };
        
        engine.timeModule = function(config, reps, module) {
            config.frontend.moduleStart(module);
            
            var deferred = process(config.executor, module.funcEntries, function(funcEntry) {
                var deferred = Deferred();
                deferred.capture(function() {
                    engine.timeFunction(config, reps, module, funcEntry);
                });
                return deferred;
            });
            
            deferred.always(function() {
                config.frontend.moduleEnd(module);
            });
            
            return deferred;
        };
        
        engine.timeFunction = function(config, reps, module, funcEntry) {
            var context = {};
            
            module.setup.call(context);
            try {
                config.timer.timeStart(module, funcEntry);
            
                var exception;
                var result;
                try {
                    config.frontend.functionStart(module, funcEntry);

                    funcEntry.func.call(context, reps);
                } catch ( e ) {
                    exception = e;
                } finally {
                    result = config.timer.timeEnd(module, funcEntry);
                }
                
                // truthiness is insufficient because the timing could 
                // potentially be 0ms
                if ( typeof result !== 'undefined' ) {
                    config.frontend.functionSuccess(module, funcEntry, result);
                } else if ( typeof exception !== 'undefined' ) {
                    config.frontend.functionFailure(module, funcEntry, exception);
                }
            } catch ( e ) {
                config.frontend.error(module, funcEntry, e);
                throw e;
            } finally {
                module.teardown.call(context);
            }                
        };
        
        return engine;
    })();
    
    
    /**
     * The actual exposed API
     */
    var giglio = (function() {
        var giglio = {};
        
        giglio.Deferred = Deferred;
        giglio.consoleFrontend = consoleFrontend;
        giglio.consoleTimer = consoleTimer;
        giglio.timeoutExecutor = timeoutExecutor;
        giglio.immediateExecutor = immediateExecutor;
        
        var config = {
            frontend: giglio.consoleFrontend,
            timer: giglio.consoleTimer,
            executor: timeoutExecutor
        };
        
        var modules = [];
        
        var nop = function() {};
        
        giglio.module = function(name, options) {
            var module = {
                name: name,
                setup: nop,
                teardown: nop,
                funcEntries: []
            };
            
            if ( options ) {
                module.setup = options.setup || module.setup;
                module.teardown = options.teardown || module.teardown;
            }
            
            modules.push(module);
        };
        giglio.time = function(name, fn) {
            if ( modules.length === 0 ) {
                giglio.module('Benchmark');
            }
            
            modules[modules.length-1].funcEntries.push({name: name, func: fn});
        };
        giglio.benchmark = function(reps) {
            engine.timeAll(config, reps, modules);
        };
        
        return giglio;
    })();
    
    window.giglio = giglio;
    // If nothing conflicts add functions to global namespace for convenience.
    window.module = window.module || giglio.module;
    window.time = window.time || giglio.time;
    window.benchmark = window.benchmark || giglio.benchmark;
})( (function() {return this;})() );