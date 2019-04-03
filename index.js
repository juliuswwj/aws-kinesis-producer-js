'use strict'
var https = require('https');

function beint(n){
    if(n & 0xffff0000){
        var b = new Buffer(4);
        b.writeUInt32BE(n, 0);
        return b;
    } 
    if(n & 0xff00){
        var b = new Buffer(2);
        b.writeUInt16BE(n, 0);
        return b;
    } 
    return new Buffer([n]);
}

function bedouble(n){
    var b = new Buffer(8);
    b.writeDoubleBE(n, 0);
    return b;
}

function benum(n){
    var b = new Buffer(8);
    b.writeUInt32BE(n>>32, 0);
    b.writeUInt32BE(n, 4);
    if(b[0]) return new Buffer([0xff]);
    if(b[1] & 0xfe){ b[0] = 1; return b; }
    if(b[1] || (b[2] & 0xfc)) { b[1] |= 2; return b.slice(1); }
    if(b[2] || (b[3] & 0xf8)) { b[2] |= 4; return b.slice(2); }
    if(b[3] || (b[4] & 0xf0)) { b[3] |= 8; return b.slice(3); }
    if(b[4] || (b[5] & 0xe0)) { b[4] |= 16; return b.slice(4); }
    if(b[5] || (b[6] & 0xc0)) { b[5] |= 32; return b.slice(5); }
    if(b[6] || (b[7] & 0x80)) { b[6] |= 64; return b.slice(6); }
    b[7] |= 0x80;
    return b.slice(7);
}

function ebml(id, data){
    return Buffer.concat([ beint(id), benum(data.length), data ]);
}

function randbuf(len){
    var b = new Buffer(len);
    for(var i = 0; i < len; i++){
        b[i] = Math.random() * 256;
    }
    return b;
}

/**
 * 
 * @param {object} options            mandatory
 * @param {number} options.timescale  optional, default 1000000, which means unit of ts is millisecond
 * @param {string} options.appmux     optional
 * @param {string} options.appwrite   optional
 * 
 * @param {object} options.v          mandatory
 * @param {string} options.v.codec    optional, default V_MPEG4/ISO/ASP
 * @param {number} options.v.duration mandatory, per frame, in ns
 * @param {number} options.v.width    mandatory
 * @param {number} options.v.height   mandatory
 * @param {Buffer} options.v.data     mandatory, codec private data
 * 
 * @param {object} options.a          optional
 * @param {string} options.a.codec    optional, default A_AAC
 * @param {number} options.a.channels optional, default 2
 * @param {number} options.a.freq     mandatory
 * @param {Buffer} options.a.data     mandatory, codec private data
 * 
 * @param {function} cb    function(data, push){}
 */
function MKVBuilder(options, cb){
    if(!(this instanceof MKVBuilder)){
        return new MKVBuilder(options, cb);
    }
    if(!cb || typeof cb !== 'function'){
        throw new Error("MKVBuilder: invalid callback");
    }

    var header = [
        ebml(0x4286, beint(1)),   // EBMLVersion
        ebml(0x42F7, beint(1)),   // EBMLReadVersion
        ebml(0x42F2, beint(4)),   // EBMLMaxIDLength
        ebml(0x42F3, beint(8)),   // EBMLMaxSizeLength
        ebml(0x4282, new Buffer('matroska')), // DocType
        ebml(0x4287, beint(2)),   // DocTypeVersion
        ebml(0x4285, beint(2)),   // DocTypeReadVersion     
    ];

    if(!options.timescale) options.timescale = 1000000;
    if(!options.appmux) options.appmux = "AWS-KINESIS-PUT-MEDIA";
    if(!options.appwrite) options.appwrite = "juliuswwj@gmail.com";

    var seginfo = [
        ebml(0x73A4, randbuf(16)), // SegmentUID
        ebml(0x2AD7B1, beint(options.timescale)),  // timescale
        ebml(0x7BA9, new Buffer(options.stream)), // title
        ebml(0x4D80, new Buffer(options.appmux)), // muxing app
        ebml(0x5741, new Buffer(options.appwrite)), // writing app
    ];

    if(!options.v.codec) options.v.codec = "V_MPEG4/ISO/ASP";
    var tracks = [
        ebml(0xAE, Buffer.concat([ // track info
            ebml(0xD7, beint(1)),   // track number
            ebml(0x73C5, beint(0x77)), // track uid
            ebml(0x83, beint(0x01)), // track type, video
            ebml(0x536E, new Buffer('video')), // track name
            ebml(0x86, new Buffer(options.v.codec)), // codec info
            ebml(0x23E383, bedouble(optins.v.duration)), // Duration
            ebml(0xE0, Buffer.concat([   // Video Info
                ebml(0xB0, beint(options.v.width)),  // width
                ebml(0xBA, beint(options.v.height)), // height
            ])),
            ebml(0x63A2, options.v.data) // private data
        ]))
    ];
    if(options.a){
        if(!options.a.codec) options.a.codec = 'A_AAC';
        if(!options.a.channles) options.a.channles = 2;
        tracks.push(ebml(0xAE, Buffer.concat([  // track info
            ebml(0xD7, beint(2)),   // track number
            ebml(0x73C5, beint(0x78)), // track uid
            ebml(0x83, beint(0x02)), // track type, audio
            ebml(0x536E, new Buffer('audio')), // track name
            ebml(0x86, new Buffer(options.a.codec)), // codec info
            ebml(0xE1, Buffer.concat([  // audio info
                ebml(0xB5, bedouble(options.a.freq)), // sampling freq
                ebml(0x9f, beint(options.a.channels)), // channels
            ])),
            ebml(0x63A2, options.a.data) // private data
        ])));
    }
    var data = [
        ebml(0x1A45DFA3, Buffer.concat(header)),  // EBML
        beint(0x18538067), new Buffer([0xff]), // Segment (unknown length)
        ebml(0x1549A966, Buffer.concat(seginfo)), // SegmentInfo
        ebml(0x1549A966, Buffer.concat(tracks)), // SegmentInfo
    ];
    cb(Buffer.concat(data), false);
    this.cb = cb;
}

/**
 * @param {Buffer} data   1 frame data
 * @param {number} ts     timestamp
 * @param {number} type   1: discardable, 8: invisible, 0x80: key frame, 0x100: audio
 */
MKVBuilder.prototype.putFrame = function(data, ts, type){
    var tmcode = ebml(0xe7, beint(ts));
    var block = Buffer.concat([beint(0xa3), benum(4 + data.length),
        benum((type>>8)+1), // track number
        new Buffer([0, 0, type&0xff])]); // sint16 timecode diff, uint8 flags
    this.cb(Buffer.concat([beint(0x1F43B675), benum(tmcode.length + block.length + data.length), tmcode, block]), false); // cluster
    this.cb(data, true); // dont concat data for performance
};

/**
 * @param {object} options 
 * @param {string} options.keyid 
 * @param {string} options.key
 * @param {string} options.region 
 * @param {string} options.stream 
 */
function Kinesis(options){
    if(!(this instanceof Kinesis)){
        return new Kinesis(optoins);
    }

    // check parameters
    if(!options.region){
        throw new Error("Kinesis: invalid options.region");
    }
    if(!options.keyid || options.keyid.length != 20){
        throw new Error("Kinesis: invalid options.keyid");
    }
    if(!options.key || options.key.length != 32){
        throw new Error("Kinesis: invalid options.key");
    }
    if(!options.stream || len(options.stream) > 128){
        throw new Error("Kinesis: invalid options.name");
    }

    if(!options.useragent){
        options.useragent = 'AWS-KINESIS-PUT-MEDIA/0.1.0 ' + process.title + '/' + process.version;
    }

    this.options = options;
}

function amzdate(){
    return (new Date()).toISOString().replace(/-|:|\.\d+/g, '');
}

/**
 * 
 * @param {object} headers 
 * @param {object} options 
 */
function genAWS4Auth(headers, options){
    var crypto = require('crypto');
    var hmac = crypto.createHmac('sha256', 'a secret');
    var algorithm = 'AWS4-HMAC-SHA256';
    var fields = ['connection', 'host', 'transfer-encoding', 'user-agent', 
        'x-amz-date', 'x-amzn-fragment-acknowledgment-required', 'x-amzn-fragment-timecode-type', 
        'x-amzn-producer-start-timestamp', 'x-amzn-stream-name'];
};


/**
 * @param {function} cb
 */
Kinesis.prototype.getEndPoint = function(cb){
    if(!cb || typeof cb !== 'function'){
        throw new Error("getEndPoint: invalid callback");
    }
    var txt = JSON.stringify({APIName:'PUT_MEDIA', StreamName:this.options.stream});
    var host = 'kinesisvideo.' + this.options.region + '.amazonaws.com';
    var options = {
        method: 'POST',
        path: '/getDataEndpoint',
        host: host,
        headers: {
            'Accept': '*/*',
            'user-agent': this.options.useragent,
            'host': host,
            'x-amz-date': amzdate(),
            'Content-Type': 'application/x-www-form-urlencoded', // same as sdk-cpp. so why?
            'Content-Length': txt.length
        },
    };
    genAWS4Auth(options.headers, this.options);
    var req = https.request(options, function(res){
        res.setEncoding('utf8');
        var body = '';
        res.on('data', function(data){
            body += data;
        });
        res.on('end', function(){
            try{
                cb(null, JSON.parse(ob));
            } catch(err) {
                cb(err);
            }
        });
    });
    req.on('error', function(err){
        cb(err);
    });
    req.write(txt);
    req.end();
}

function putMedia(options, url, cb){
    // parse https://s-4010bf70.kinesisvideo.us-west-2.amazonaws.com
    var host = url.substring( url.indexOf('//')+2 );  
    var opt = {
        method: 'POST',
        path: '/putMedia',
        host: host,
        headers: {
            'Accept': '*/*',
            'user-agent': options.useragent,
            'host': host,
            'connection': 'keep-alive',
            'x-amz-date': amzdate(),
            'transfer-encoding': 'chunked',
            'x-amzn-fragment-acknowledgment-required': 1,
            'x-amzn-fragment-timecode-type': 'RELATIVE',
            'x-amzn-producer-start-timestamp': Date.now()/1000,
            'x-amzn-stream-name': options.stream,
            'Content-Type': 'application/x-www-form-urlencoded', // same as sdk-cpp. so why?
            'Expect': '100-continue'
        },
    };

    var req = https.request(opt, function(res){
        res.setEncoding('utf8');
        res.on('data', function(data){
            var n = data.indexOf('\r\n');
            cb(null, 'message', n);
        });
        res.on('end', function(){
            cb(null, 'end');
        })
        cb(null, 'connect');
    });

    req.on('error', function(err){
        cb(err);
    });

    // we will send chunked data, so dont write or end here
    return req;
}


/**
 * @param {function} cb  function(err, event, data)
 */
Kinesis.prototype.start = function(cb){
    if(!cb || typeof cb !== 'function'){
        throw new Error("start: invalid callback");
    }

    // queue data, then send it in chunked format
    var BLOCKSIZE = 16384;
    var dq = [];
    var dptr = 0;
    var req = null;
    var endian = '';
    function dosend(){
        if(dq.length == 0)return;
        var d = dq[0];
        if(d.length-dptr > BLOCKSIZE){
            req.write(endian + BLOCKSIZE.toString(16) + '\r\n');
            req.write(d.slice(dptr, dptr+BLOCKSIZE-1), dosend);
            dptr += BLOCKSIZE;
        } else {
            req.write(endian + (d.length - dptr).toString(16) + '\r\n');
            req.write(d.slice(dptr), dosend);
            dptr = 0;
            dq.shift();
        }
    }

    this.mkv = new MKVBuilder(this.options, function(data){
        dq.push(data);
        if(dq.length == 1 && req){
            dosend();
            endian = '\r\n';
        }
    });


    // run web api
    this.getEndPoint(function(err, ob){
        if(err) { 
            cb(err); 
            return; 
        }
        try {
            req = putMedia(this.options, ob.DataEndpoint, cb);
        }
        catch(err){
            cb(err);
        }
    });
};

/**
 * @param {Buffer} data
 * @param {number} type
 */
Kinesis.prototype.putFrame = function(data, type){
    if(!this.mkv)throw new Error('putFrame: not started');
    this.mkv.putFrame(data, type);
}


module.exports = {
    Kinesis: Kinesis,
    MKVBuilder: MKVBuilder,
    genAWS4Auth: genAWS4Auth,
};
