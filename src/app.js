"use strict";

var app = angular.module('myModule', []);

app.config(['$routeProvider', function($routeProvider) {
    $routeProvider.when('/files', {
	templateUrl: "templates/files.html"
    }).when('/hash', {
	templateUrl: "templates/hash.html"
    }).when('/torrent', {
	templateUrl: "templates/torrent.html"
    }).otherwise({ redirectTo: "/files" });
}]);

app.directive('fileReceiver', function() {
	return {
	    restrict: 'A',
	    link: function($scope, element, attrs) {
		element.bind('change', function(ev) {
		    var el = ev.target || ev.srcElement;
		    var files = el.files;
		    $scope.$apply(function() {
			var cb = $scope[attrs['fileReceiver']];
			for(var i = 0; i < files.length; i++)
			    cb(ev.target.files.item(i));
		    });
		});
	    }
	};
    });

function humanSize(size) {
    var units = ["B", "KB", "MB", "GB", "TB"];
    while(size >= 1024 && units.length > 1) {
	size /= 1024;
	units.shift();
    }
    if (size < 10) {
	return Math.round(size * 10) / 10 + " " + units[0];
    } else {
	return Math.round(size) + " " + units[0];
    }
};

/* TODO: https://developer.mozilla.org/en-US/docs/Using_files_from_web_applications#Selecting_files_using_drag_and_drop */
app.controller('FilesController', ['$scope', '$location', 'Hasher',
	function($scope, $location, Hasher) {
    $scope.files = [];
    $scope.updateTotalSize = function() {
	$scope.bytesTotal = 0;
	$scope.torrentSizeEstimate = 256;
	$scope.files.forEach(function(file) {
	    $scope.bytesTotal += file.size;
	    $scope.torrentSizeEstimate += file.name.length + 4;
	});
	$scope.torrentSizeEstimate += Math.ceil(20 * $scope.bytesTotal / $scope.pieceLength);
	if ($scope.torrentSizeEstimate < 1024)
	    $scope.torrentSizeEstimate = 1024;
    };
    $scope.updateTotalSize();

    $scope.addFile = function(file) {
	console.log("addFile", file);
	$scope.files.push(file);
	$scope.updateTotalSize();
    };

    $scope.rmFile = function(file) {
	$scope.files = $scope.files.filter(function(file2) {
	    return file !== file2;
	});
	$scope.updateTotalSize();
    };

    $scope.startHashing = function() {
	Hasher.start($scope.files, $scope.pieceLength);
	$location.path('/hash');
    };

    $scope.pieceLengths = [16, 17, 18, 19, 20, 21, 22, 23, 24].map(Math.pow.bind(Math, 2));
    $scope.pieceLength = 262144;
    $scope.humanSize = humanSize;
}]);

app.factory('Hasher', function() {
    var files = [];
    var updateCbs = [], finishCbs = [];
    var result = null;

    function hashFiles(files, pieceLength) {
	var pieces = [];
	var progress = { bytesRead: 0, bytesTotal: 0 };
	files.forEach(function(file) {
	    progress.bytesTotal += file.size;
	});
	files = files.concat();  /* We're destructive */

	var sha1 = new Digest.SHA1();
	function finish() {
	    pieces.push(sha1.finalize());
	    result = {
		pieceHashes: pieces,
		pieceLength: pieceLength
	    };
	    finishCbs.forEach(function(finishCb) {
		finishCb(result);
	    });
	    /* In this app flow they're not needed anymore because controller changes */
	    updateCbs = [];
	    finishCbs = [];
	}
	function hashPiece(file, fileOffset, files, piecePos) {
	    if (!file)
		/* No files remain */
		return finish();

	    if (fileOffset >= file.size) {
		/* Proceed with next file */
		file = files.shift();
		return hashPiece(file, 0, files, piecePos);
	    }

	    if (piecePos >= pieceLength) {
		/* One piece done */
		pieces.push(sha1.finalize());
		sha1 = new Digest.SHA1();
		piecePos = 0;
	    }

	    /* Read in 64kb chunks, or tail of file, or what is left of current chunk */
	    var chunkSize = Math.min(64 * 1024, file.size - fileOffset, pieceLength - piecePos);
	    var reader = new FileReader();
	    reader.onload = function() {
		sha1.update(reader.result);
		progress.bytesRead += reader.result.byteLength;
		updateCbs.forEach(function(updateCb) {
		    updateCb(progress);
		});
		hashPiece(file, fileOffset + chunkSize, files, piecePos + chunkSize);
	    };
	    reader.readAsArrayBuffer(file.slice(fileOffset, fileOffset + chunkSize));

	}
	var file = files.shift();
	hashPiece(file, 0, files, 0);
    }

    return {
	start: function(files_, pieceLength) {
	    files = files_;
	    console.log("Hasher.start", files, pieceLength);
	    result = null;

	    hashFiles(files, pieceLength);
	},
	onProgress: function(updateCb, finishCb) {
	    console.log("onProgress", updateCb, finishCb);
	    if (result)
		return finishCb(result);
	    else {
		updateCbs.push(updateCb);
		finishCbs.push(finishCb);
	    }
	},
	getFiles: function() {
	    return files;
	},
	guessTorrentName: function() {
	    if (files.length == 1)
		/* Single file case */
		return files[0].name;
	    else {
		var parts = files[0].name.split(".");
		return parts[parts.length - 1];
	    }
	}
    };
});

app.controller('HashController', ['$scope', '$location', 'Hasher', 'Torrentify', function($scope, $location, Hasher, Torrentify) {
    $scope.trackerlist = "udp://tracker.openbittorrent.com:80\n" +
	"udp://tracker.publicbt.com:80\n" +
	"udp://tracker.istole.it:80\n" +
	"udp://tracker.ccc.de:80\n";
    $scope.torrentname = Hasher.guessTorrentName();
    $scope.showTorrentname = Hasher.getFiles().length > 1;
    $scope.humanSize = humanSize;

    var rates = [], bytesLast = 0;
    function onUpdate(progress) {
	$scope.$apply(function() {
	    $scope.finished = false;
	    $scope.progress = progress;

	    /* Average rate over last 5s */
	    var now = new Date().getTime();
	    while(rates[0] && rates[0].time < now - 5000)
		rates.shift();
	    rates.push({ bytes: progress.bytesRead - bytesLast,
			 time: now
		       });
	    bytesLast = progress.bytesRead;
	    $scope.rate = 0;
	    rates.slice(1).forEach(function(rate) {
		$scope.rate += rate.bytes;
	    });
	    if (rates.length > 0) {
		$scope.rate /= Math.max(1, rates[rates.length - 1].time - rates[0].time) / 1000;
	    } else {
		$scope.rate = 0;
	    }
	});
    }
    function onFinish(result) {
	console.log("finish", result);
	$scope.$apply(function() {
	    $scope.result = result;
	    $scope.finished = true;
	});
    }
    Hasher.onProgress(onUpdate, onFinish);

    $scope.finalize = function() {
	var trackerList = $scope.trackerlist.split("\n").filter(function(trackerUrl) {
	    return trackerUrl.length > 0;
	});
	Torrentify.finalize($scope.torrentname, Hasher.getFiles(),
			    $scope.result.pieceLength, $scope.result.pieceHashes,
			    trackerList);
	$location.path('/torrent');
    };
}]);

function iolist2ByteArray(l) {
    var size = 0;
    function measureSize(l) {
	if (l.constructor === Array) {
	    l.forEach(measureSize);
	} else if (l.constructor === String) {
	    size += l.length;
	} else {
	    size += l.byteLength;
	}
	console.log("measureSize",l,"size",size)
    }
    measureSize(l);

    var result = new Uint8Array(size), offset = 0;
    function copy(l) {
	var i;
	if (l.constructor === Array) {
	    l.forEach(copy);
	} else if (l.constructor === String) {
	    for(i = 0; i < l.length; i++) {
		result[offset] = l.charCodeAt(i);
		offset++;
	    }
	} else {
	    l = new Uint8Array(l);
	    for(i = 0; i < l.byteLength; i++) {
		result[offset] = l[i];
		offset++;
	    }
	}
    }
    copy(l);
    return result;
}

function torrent2iolist(x) {
    var r = [];
    switch(x.constructor) {
    case Object:
	r.push("d");
	Object.keys(x).sort().forEach(function(k) {
	    if (x.hasOwnProperty(k)) {
		r.push(torrent2iolist(k));
		r.push(torrent2iolist(x[k]));
	    }
	});
	r.push("e");
	break;
    case Array:
	r.push("l");
	for(var i = 0; i < x.length; i++)
	    r.push(torrent2iolist(x[i]));
	r.push("e");
	break;
    case Number:
	r.push("i", Math.floor(x).toString(), "e");
	break;
    default:
	if (x.constructor === String)
	    x = strToUTF8Arr(x);
	r.push(x.byteLength.toString(), ":", x);
    }
    return r;
}

app.factory('Torrentify', function() {
    var torrentName, file;
    return {
	finalize: function(torrentName_, files, pieceLength, pieceHashes, trackerList) {
	    torrentName = torrentName_;
	    var pieces = new Uint8Array(pieceHashes.length * 20);
	    for(var i = 0; i < pieceHashes.length; i++) {
		var hash = new Uint8Array(pieceHashes[i]);
		for(var j = 0; j < 20; j++)
		    pieces[i * 20 + j] = hash[j];
	    }
	    var torrent = {
		announce: trackerList[0],
		"announce-list": trackerList.map(function(trackerUrl) {
		    return [trackerUrl];
		}),
		info: {
		    "piece length": pieceLength,
		    "pieces": pieces,
		    "name": torrentName
		}
	    };
	    if (files.length == 1) {
		torrent.info.length = files[0].size;
	    } else {
		torrent.info.files = files.map(function(file) {
		    var parts = file.name.split("/");
		    return {
			path: [parts[parts.length - 1]],
			length: file.size
		    };
		});
	    }
	    file = iolist2ByteArray(torrent2iolist(torrent));
	},
	getTorrentName: function() {
	    return torrentName;
	},
	getAsBase64: function() {
	    console.log("getAsBase64", file, base64EncArr(file));
	    return base64EncArr(file);
	},
	getAsBlob: function() {
	    return new Blob([file], { type: "application/x-bittorrent" });
	}
    };
});

/* TODO: http://stackoverflow.com/questions/7160720/create-a-file-using-javascript-in-chrome-on-client-side/7160827#7160827 */
app.controller('TorrentController', ['$scope', 'Torrentify', function($scope, Torrentify) {
    $scope.torrentname = Torrentify.getTorrentName() + ".torrent";
    $scope.base64 = Torrentify.getAsBase64();
    var blob = Torrentify.getAsBlob();
    $scope.objUrl = URL.createObjectURL(blob);

    function errorHandler(error) {
	$scope.error = error && (error.message || error.toString());
    }

    var requestFileSystem = window.requestFileSystem ||
	window.webkitRequestFileSystem ||
	window.mozRequestFileSystem;
    requestFileSystem(window.TEMPORARY, blob.size, function(fs) {
	fs.root.getFile($scope.torrentname, { create: true }, function(fileEntry) {
	    fileEntry.createWriter(function(fileWriter) {
		fileWriter.onerror = errorHandler;
		fileWriter.addEventListener("writeend", function() {
		    /* navigate to file, will download */
		    location.href = fileEntry.toURL();
		}, false);
		fileWriter.write(blob);
	    }, errorHandler);
	}, errorHandler);
    }, errorHandler);
}]);
