#!/usr/bin/env node

"use strict";

const
	commandLineArgs = require("command-line-args"),
	getUsage = require("command-line-usage"),
	readline = require("readline"),
	
	AWS = require("aws-sdk");


/**
 * @param s3
 * @param {String} bucket
 * @param {String} prefix
 *
 * @returns {Promise.<AWS.S3.Types.ListMultipartUploadsOutput>}
 */
function findMultipartUploadsInBucket(s3, bucket, prefix) {
	let
		params = {
			Bucket: bucket
		};
	
	if (prefix) {
		params.Prefix = prefix;
	}
	
	return s3.listMultipartUploads(params).promise().catch(err => {
		console.error("Failed to list multipart uploads in bucket \"" + bucket + "\", do you have permissions for that bucket?");
		
		throw err;
	});
}

function printMultipartUploads(results) {
	let
		collected = {};
	
	for (let /** @type {S3.Types.ListMultipartUploadsOutput} */ result of results) {
		collected[result.Bucket] = result.Uploads;
	}
	
	console.log(JSON.stringify(collected, null, 4) + "\n");
}

function abortMultipartUploads(s3, results) {
	let
		abortCount = 0,
		promise = Promise.resolve();
	
	for (let /** @type {S3.Types.ListMultipartUploadsOutput} */ result of results) {
		for (let upload of result.Uploads) {
			promise = promise.then(() => {
				abortCount++;
				
				return s3.abortMultipartUpload({
					Bucket: result.Bucket,
					Key: upload.Key,
					UploadId: upload.UploadId
				}).promise();
			});
		}
	}
	
	return promise.then(
		() => {
			console.log("Aborted " + abortCount + " multipart uploads.");
		},
		(err) => {
			console.error("Error! " + err);
			process.exitCode = 1;
		}
	);
}

const
	optionDefinitions = [
		{
			name: "help",
			type: Boolean,
			description: "Show this page\n"
		},
		{
			name: "bucket",
			type: String,
			typeLabel: "[underline]{name}",
			description: "Only find uploads in this bucket (optional)"
		},
		{
			name: "prefix",
			type: String,
			typeLabel: "[underline]{key}",
			description: "Only find uploads with this key prefix (optional)"
		},
		{
			name: "abort",
			type: Boolean,
			defaultValue: false,
			description: "Abort the uploads that are found (after prompt)"
		},
		{
			name: "force",
			type: Boolean,
			defaultValue: false,
			description: "Don't prompt to confirm abortion"
		}
	],
	
	usageSections = [
		{
			header: "abort-incomplete-multipart",
			content: "Find and abort incomplete S3 multipart uploads"
		},
		{
			header: "Options",
			optionList: optionDefinitions
		}
	],
	
	// Parse command-line options
	options = commandLineArgs(optionDefinitions);

class OptionsError extends Error {
	constructor(message) {
		super(message);
	}
}

if (options.help) {
	console.log(getUsage(usageSections));
} else {
	Promise.resolve().then(function() {
		for (let option of optionDefinitions) {
			if (option.required) {
				if (options[option.name] === undefined) {
					throw new OptionsError("Option --" + option.name + " is required!");
				} else if (options[option.name] === null) {
					throw new OptionsError("Option --" + option.name + " requires an argument!");
				}
			}
		}
	
		let
			findUploads,
			s3 = new AWS.S3();
		
		if (options["bucket"]) {
			findUploads = findMultipartUploadsInBucket(s3, options["bucket"], options["prefix"])
				// Put the single result into an array for consistency:
				.then(data => [data]);
		} else {
			findUploads = s3.listBuckets().promise().then(
				data => {
					let
						promise = Promise.resolve([]);

					for (let bucket of data.Buckets) {
						// Concat the results from each bucket together into a array:
						promise = promise.then(
							foundSoFar => findMultipartUploadsInBucket(s3, bucket.Name, options.prefix).then(
								foundThisTime => foundSoFar.concat(foundThisTime)
							)
						);
					}
					
					return promise;
				},
				err => {
					console.error("Failed to list buckets, do you have permission to do that for all regions? Perhaps supply --bucket <bucketname> instead.");
					
					throw err;
				}
			);
		}
		
		return findUploads.then(results => {
			printMultipartUploads(results);
			
			if (options.abort) {
				if (options.force) {
					return abortMultipartUploads(s3, results);
				} else {
					const rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout
					});
					
					rl.question("Are you sure you want to abort these multipart uploads? (yes/no) ", answer => {
						if (answer === "yes") {
							return abortMultipartUploads(s3, results).then(() => {
								rl.close();
							});
						} else {
							console.log("Okay, not aborting anything.");
							rl.close();
						}
					});
				}
			} else {
				console.log("To actually abort these incomplete uploads, pass the --abort flag");
			}
		});
	})
	.catch(err => {
		process.exitCode = 1;
		
		if (err instanceof OptionsError) {
			console.error(err.message);
		} else {
			console.error("Error: " + err + " " + (err.stack ? err.stack : ""));
			console.error("");
			console.error("Terminating due to fatal errors.");
		}
	});
}