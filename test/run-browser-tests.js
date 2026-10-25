/* Runs the jQuery QUnit suite (test/index.html) in headless Chrome, one run per
 * module (the TestSwarm way), and prints per-test results plus a summary.
 * Usage: node test/run-browser-tests.js <url of test/index.html> <module>... */
"use strict";

var puppeteer = require( "puppeteer-core" );

var baseUrl = process.argv[ 2 ];
var modules = process.argv.slice( 3 );
var chrome = process.env.CHROME_BIN || "google-chrome";

// Tests that cannot pass in a current headless Chrome, independent of jQuery's code
var SKIPPED = {
	"#14379 - jQuery.ajax() on unload": "Chrome 80+ disallows synchronous XHR during " +
		"page dismissal (unload), so the request always ends in \"error\"",
	"fractions (see #7730 and #7885)": "Chrome's LayoutNG snaps layout to 1/64px, so " +
		"offset().top reads 999.984375 instead of 1000"
};

function hook( skipped ) {
	document.addEventListener( "DOMContentLoaded", function() {
		var Q = window.QUnit, cur = [], origTest = window.test, origModule = window.module,
			curModule;

		// Iframes of the suite load this hook too; only the main test page reports
		if ( window !== window.top || !Q ) { return; }

		// The unit files load after DOMContentLoaded and declare tests via the global test()
		window.module = function( name ) {
			curModule = name;
			return origModule.apply( this, arguments );
		};
		window.test = function( name ) {
			if ( skipped.hasOwnProperty( name ) ) {
				if ( Q.config.module && Q.config.module.toLowerCase() !== curModule.toLowerCase() ) {
					return;
				}
				console.log( "__QUNIT__" + JSON.stringify( { type: "skip", module: curModule, name: name,
					reason: skipped[ name ] } ) );
				return;
			}
			return origTest.apply( this, arguments );
		};
		Q.log( function( d ) {
			if ( !d.result ) {
				cur.push( ( d.message || "" ) + ( d.expected !== undefined ?
					" expected: " + String( d.expected ) + " actual: " + String( d.actual ) : "" ) );
			}
		} );
		Q.testDone( function( d ) {
			console.log( "__QUNIT__" + JSON.stringify( { type: "test", module: d.module,
				name: d.name, failed: d.failed, passed: d.passed, total: d.total, errors: cur } ) );
			cur = [];
		} );
		Q.done( function( d ) {
			console.log( "__QUNIT__" + JSON.stringify( { type: "done", failed: d.failed,
				passed: d.passed, total: d.total, runtime: d.runtime } ) );
		} );
	} );
}

( async function() {
	var browser = await puppeteer.launch( { executablePath: chrome, headless: "new",
		args: [ "--no-sandbox", "--disable-gpu" ] } );
	var tot = { tests: 0, testsFailed: 0, skipped: 0, assertions: 0, assertionsFailed: 0 };
	var failedModules = [];

	for ( var i = 0; i < modules.length; i++ ) {
		var mod = modules[ i ];
		var page = await browser.newPage();
		var summary = await new Promise( async function( resolve ) {
			var timer = setTimeout( function() { resolve( null ); }, 10 * 60 * 1000 );
			page.on( "console", function( msg ) {
				var t = msg.text();
				if ( t.indexOf( "__QUNIT__" ) !== 0 ) { return; }
				var d = JSON.parse( t.slice( 9 ) );
				if ( d.type === "skip" ) {
					tot.skipped++;
					console.log( "  SKIP " + d.module + " :: " + d.name + " -- " + d.reason );
				} else if ( d.type === "test" ) {
					tot.tests++;
					if ( d.failed ) {
						tot.testsFailed++;
						console.log( "  FAIL " + d.module + " :: " + d.name +
							" (" + d.failed + "/" + d.total + " assertions failed)" );
						d.errors.forEach( function( e ) { console.log( "       - " + e ); } );
					} else {
						console.log( "  PASS " + d.module + " :: " + d.name +
							" (" + d.total + " assertions)" );
					}
				} else {
					clearTimeout( timer );
					resolve( d );
				}
			} );
			page.on( "pageerror", function( e ) { console.log( "  [pageerror] " + e.message ); } );
			await page.evaluateOnNewDocument( hook, SKIPPED );
			await page.goto( baseUrl + "?module=" + encodeURIComponent( mod ) );
		} );
		if ( !summary ) {
			console.log( "Module " + mod + ": TIMED OUT" );
			failedModules.push( mod );
		} else {
			tot.assertions += summary.total;
			tot.assertionsFailed += summary.failed;
			console.log( "Module " + mod + ": " + summary.passed + " assertions passed, " +
				summary.failed + " failed, " + summary.total + " total (" + summary.runtime + "ms)" );
			if ( summary.failed ) { failedModules.push( mod ); }
		}
		await page.close();
	}
	await browser.close();

	console.log( "==========================================" );
	console.log( "Tests: " + ( tot.tests - tot.testsFailed ) + " passed, " + tot.testsFailed +
		" failed, " + tot.skipped + " skipped, " + tot.tests + " total" );
	console.log( "Assertions: " + ( tot.assertions - tot.assertionsFailed ) + " passed, " +
		tot.assertionsFailed + " failed, " + tot.assertions + " total" );
	if ( failedModules.length ) {
		console.log( "Failed modules: " + failedModules.join( " " ) );
		process.exit( 1 );
	}
} )().catch( function( e ) { console.error( e ); process.exit( 1 ); } );
