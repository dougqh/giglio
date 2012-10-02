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
        frontend.requiresOutput = false;
        
        frontend.moduleStart = function(module) {
            console.log('Benchmarking ' + module.name + '...');
        };
        frontend.functionStart = function(module, funcEntry, reps) {
            console.log('Running ' + funcEntry.name + ' for ' + reps + ' reps...');
        };
        frontend.functionSuccess = function(module, funcEntry, timeMs, reps ) {
            console.log(module.name + ' ' + funcEntry.name + ' ' + ( timeMs / reps ) + 'ms/rep');
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
        timer.hasOutput = false;
        
        timer.envCompatible = function() {
        	return ( typeof console.time !== 'undefined' )
        };
        timer.timeStart = function(module, entry) {
            console.time(module.name + ' - ' + entry.name);
        };
        timer.timeEnd = function(module, entry) {
            console.timeEnd(module.name + ' - ' + entry.name);
        };
        
        return timer;
    })();
    
    /**
     * Date timer
     */
    var dateTimer = (function() {
    	var timer = {};
    	timer.id = 'date';
    	timer.hasOutput = true;
    	
    	timer.envCompatible = function() {
    		return ( typeof Date !== 'undefined' );
    	};
    	timer.timeStart = function(module, entry) {
    		this._start = new Date().getTime();	
    	};
    	
    	timer.timeEnd = function(module, entry) {
    		return new Date().getTime() - this._start;
    	};
    	
    	return timer;
    })();
    
    var defaultTimer = (function() {
    	if ( consoleTimer.envCompatible() ) {
    		return consoleTimer;
    	}
    	if ( dateTimer.envCompatible() ) {
    		return dateTimer;
    	}
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
        	if ( config.frontend.requiresOutput && ! config.timer.hasOutput ) {
        		throw new Error(
        			'incompatible combination using timer without output ' + 
        			'with a front-end that requires output'
        		);
        	}
        
            return process(config.executor, modules, function(module) {
                return engine.timeModule(config, reps, module);
            });
        };
        
        engine.calculateParameterSetsFor = function(module) {
        	var combinations = [];
        	
        	// Builds up a full cartesian product of parameter combinations
        	// through multiple successive passes.
        	for ( var property in module.params ) {
        		if ( ! module.params.hasOwnProperty(property) ) {
        			continue;
        		}
        		
        		var values = module.params[property];
        		
        		if ( combinations.length === 0 ) {
        			// first pass is seeding pass for the first property
        			for ( var i = 0, len = values.length; i < len; ++i ) {
        				var combination = {};
        				combination[property] = values[i];
        				
        				combinations.push(combination);
        			}
        		} else {
        			// successive passes - clone the first and for each 
        			// entry create N new entries for all possible values
        			
        			var oldCombinations = combinations.slice(0, combinations.length);
        			combinations = [];
        			for ( var i = 0, outerLen = oldCombinations.length; i < outerLen; ++i ) {
        				for ( var j = 0, innerLen = values.length; j < innerLen; ++j ) {
        					var combination = oldCombinations[i];
        					combination[property] = values[j];
        					
        					combinations.push(combination);
        				}
        			}
        		}
        	}
        	
        	if ( combinations.length === 0 ) {
        		combinations.push(undefined);	
        	}
        	
        	return combinations;
        };
        
        engine.timeModule = function(config, reps, module) {
            config.frontend.moduleStart(module);
            
            var parameterSets = engine.calculateParameterSetsFor(module);
            
            var deferred = process(config.executor, parameterSets, function(parameterSet) {
            	return engine.timeParameterSet(config, reps, module, parameterSet);
            });
            
            deferred.always(function() {
                config.frontend.moduleEnd(module);
            });
            
            return deferred;
        };
        
        engine.timeParameterSet = function(config, reps, module, parameterSet) {
        	return process(config.executor, module.funcEntries, function(funcEntry) {
                var deferred = Deferred();
                deferred.capture(function() {
                    engine.timeFunction(config, reps, module, funcEntry, parameterSet);
                });
                return deferred;
            });
        };
        
        engine.timeFunction = function(config, reps, module, funcEntry, parameterSet) {
            var context = {};
            
            module.setup.call(context, parameterSet);
            try {
				if ( engine._warmup(config, reps, module, funcEntry, context) ) {
					engine._execute(config, reps, module, funcEntry, context, parameterSet);
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
    
	engine._warmup = function(config, reps, module, funcEntry, context) {
		try {
			// Call repeatedly with a single rep to make sure the function gets JIT-ed.
			for ( var i = 0; i < reps; ++i ) {
				funcEntry.func.call(context, 1);
			}
			return true;
		} catch ( e ) {
			config.frontend.functionFailure(module, funcEntry, e);
			return false;
		}
	};
	
	engine._execute = function(config, reps, module, funcEntry, context, parameterSet) {
		config.timer.timeStart(module, funcEntry);
	
		var exception;
		var result;
		try {
			config.frontend.functionStart(module, funcEntry, reps, parameterSet);

			funcEntry.func.call(context, reps);
		} catch ( e ) {
			exception = e;
		} finally {
			result = config.timer.timeEnd(module, funcEntry, parameterSet);
		}
		
		// truthiness is insufficient because the timing could potentially be 0ms
		if ( typeof result !== 'undefined' ) {
			config.frontend.functionSuccess(module, funcEntry, result, reps);
		} else if ( typeof exception !== 'undefined' ) {
			config.frontend.functionFailure(module, funcEntry, exception);
		}
	};
    
    /**
     * The actual exposed API
     */
    var giglio = (function() {
        var giglio = {};
        
        giglio.Deferred = Deferred;
        giglio.consoleFrontend = consoleFrontend;
        giglio.consoleTimer = consoleTimer;
        giglio.dateTimer = dateTimer;
        giglio.defaultTimer = defaultTimer;
        giglio.timeoutExecutor = timeoutExecutor;
        giglio.immediateExecutor = immediateExecutor;
        
        var config = {
            frontend: giglio.consoleFrontend,
            timer: giglio.defaultTimer,
            executor: giglio.timeoutExecutor
        };
        
        var modules = [];
        
        var nop = function() {};
        
        giglio.module = function(name, options) {
            var module = {
                name: name,
                params: {},
                setup: nop,
                teardown: nop,
                funcEntries: []
            };
            
            if ( options ) {
            	module.params = options.params || module.params;
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