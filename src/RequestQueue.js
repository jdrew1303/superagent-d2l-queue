'use strict';

const retry = require( './Retry' );

function requestQueue( params ) {

	const superagentEnd = this.end;

	const options = Object.assign({
		queue: undefined, // Array
		retryNotifier: undefined,
		retryEnabled: false
	}, params );

	// Deep merge all the parameters so client does not need to provide
	// the entire backoff object if they only want to tweak one parameter
	const backoff = Object.assign({
		initialTimeout: 2000,
		maxTimeout: undefined,
		expFactor: 1.4,
		retries: 5,
		override: _computeWaitPeriod
	}, params.backoff );

	options.backoff = backoff;

	this.queue = options.queue;
	this.retryNotifier = options.retryNotifier;
	this.retryEnabled = options.retryEnabled;

	let retryCount = 0;
	let retryWaitPeriod = 0;

	function _computeWaitPeriod( retryCount ) {
		return Math.round( options.backoff.initialTimeout *
			Math.pow( options.backoff.expFactor, retryCount ) );
	}

	function _resetRequest( request, timeout ) {

		let headers = {};

		if ( request.req ) {
			headers = request.req._headers;
			request.req.abort();
		}

		request.called = false;
		request.timeout( timeout );

		delete request._timer;
		delete request.timer;
		delete request.aborted;
		delete request._aborted;
		delete request.timedout;
		delete request.req;
		delete request.xhr;

		const headerKeys = Object.keys( headers );
		for( let i = 0; i < headerKeys.length; i++ ) {
			request.set( headerKeys[i], headers[headerKeys[i]] );
		}
	}

	function _returnResponse( fn, err, res ) {
		fn && fn( err, res );
	}

	function _sendNextRequest() {

		const item = this.queue[0];
		if ( item ) {
			_sendRequest( item.request, item.fn, item.timeout );
		}

	}

	function _sendRequest( request, fn, timeout ) {

		superagentEnd.call( request, ( err, res ) => {

			if ( request.retryEnabled && retry.should( err, res ) ) {

				request.retryNotifier && request.retryNotifier( err );

				if ( retryCount !== options.backoff.retries
					&& retryWaitPeriod < options.backoff.maxTimeout ) {
					retryCount = retryCount + 1;
					retryWaitPeriod = options.backoff.override( retryCount );
				}

				if ( retryWaitPeriod > options.backoff.maxTimeout ) {
					retryWaitPeriod = options.backoff.maxTimeout;
				}

				setTimeout( function() {
					_resetRequest( request, timeout );
					_sendRequest( request, fn, request._timeout );
				}, retryWaitPeriod );
			} else {
				retryCount = 0;
				retryWaitPeriod = 0;
				_returnResponse( fn, err, res );

				if ( request.queue ) {
					request.queue.shift();
					_sendNextRequest.call( request );
				}
			}

		});

	}

	this.end = function( fn ) {

		if ( this.queue ) {

			this.queue.push(
				{
					request: this,
					fn: fn,
					timeout: this._timeout
				}
			);

			if ( this.queue.length === 1 ) {
				_sendNextRequest.call(this);
			}
		} else {
			_sendRequest( this, fn, this._timeout );
		}

	};

	return this;
}

function create(params) {
	return function(request) {
		return requestQueue.call(request, params);
	};
};

create.makeQueue = function() {
	return [];
};

module.exports = create;
