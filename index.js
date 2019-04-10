/*jshint node: true */
'use strict';

var https = require('https');
var crypto = require('crypto');

// functions to compatible with iotjs
var fromNumber = Buffer.fromNumber;
if(!fromNumber) fromNumber = function(data){
    if(data < 0x100) return new Buffer([data&0xff]);
    else if(data < 0x10000) return new Buffer([data>>8, data&0xff]);
    else if(data < 0x1000000) return new Buffer([data>>16, (data>>8)&0xff, data&0xff]);
    else return new Buffer([data>>24, (data>>16)&0xff, (data>>8)&0xff, data&0xff]);
};

var fromEBML = Buffer.fromEBML;
if(!fromEBML) fromEBML = function(n, data){
    function enm(n){
        if(n < 0) return new Buffer([0xff]);

        n += 1;
        var b = new Buffer(8);
        b.writeUInt32BE(n/65536/65536, 0); // only / can handle 32+ bits
        b.writeUInt32BE(n&0xffffffff, 4);
    
        if(b[0]) return new Buffer([0xff]);
    
        var c = 0;
        if(b[1] & 0xfe) c=0;
        else if(b[1] || (b[2] & 0xfc)) c=1;
        else if(b[2] || (b[3] & 0xf8)) c=2;
        else if(b[3] || (b[4] & 0xf0)) c=3;
        else if(b[4] || (b[5] & 0xe0)) c=4;
        else if(b[5] || (b[6] & 0xc0)) c=5;
        else if(b[6] || (b[7] & 0x80)) c=6;
        else c=7;
    
        n -= 1;
        b.writeUInt32BE(n/65536/65536, 0); // only / can handle 32+ bits
        b.writeUInt32BE(n&0xffffffff, 4);
    
        b[c] |= 1<<c;
        return b.slice(c);
    }

    var h = null;
    if(n & 0x10000000) h = enm(n & 0xfffffff);
    else if(n & 0x200000) h = enm(n & 0x1fffff);
    else if(n & 0x4000) h = enm(n & 0x3fff);
    else h = enm(n & 0x7f);
    if(data === null) return Buffer.concat([h, new Buffer([0xff])]);
    if(typeof data === 'number') {
        if(data < 0) return Buffer.concat([h, enm(-data)]);  // no data, only length
        data = fromNumber(data);
    }
    if(typeof data === 'string') data = new Buffer(data);
    if(!(data instanceof Buffer)) throw new Error('fromEBML need buffer but get ' + typeof data);
    return Buffer.concat([ h, enm(data.length), data ]);
};

var toENum = Buffer.toENum;
if(!toENum) toENum = function(buf){
    var c = 0;
    var i = buf.epos || 0;
    var e = i + 8;
    for(; i<e; i++){
        if(buf[i] == 0) continue;
        if(buf[i] == 0xff) {
            buf.epos = i+1;
            return -1;
        }
        if(buf[i] & 128) { c = 0; break; }
        if(buf[i] & 64) { c = 1; break; }
        if(buf[i] & 32) { c = 2; break; }
        if(buf[i] & 16) { c = 3; break; }
        if(buf[i] & 8) { c = 4; break; }
        if(buf[i] & 4) { c = 5; break; }
        if(buf[i] & 2) { c = 6; break; }
        if(buf[i] & 1) { c = 7; break; }
    }
    var v = buf[i] & ((1<<(7-c))-1);
    i += 1;
    buf.epos = i + c;
    while(c > 0){
        v = v * 256 + buf[i];
        c -= 1;
        i += 1;
    }
    return v;
};

var toNumber = Buffer.toNumber;
if(!toNumber) toNumber = function(buf){
    if(buf.length == 1) return buf[0];
    if(buf.length == 2) return buf.readUInt16BE(0);
    if(buf.length == 4) return buf.readUInt32BE(0);
    return -1;
};

var fromDouble = Buffer.fromDouble;
if(!fromDouble) fromDouble = function(n){
    var b = new Buffer(8);
    b.writeDoubleBE(n, 0);
    return b;
};

var toDouble = Buffer.toDouble;
if(!toDouble) toDouble = function(b){
    return b.readDoubleBE(0);
};




/**
 * 
 * @param {object} options            mandatory
 * @param {object} options.stream     mandatory
 * @param {number} options.timescale  optional, default 1000000, which means unit of ts is millisecond
 * @param {string} options.appmux     optional
 * @param {string} options.appwrite   optional
 * 
 * @param {object} options.v          mandatory
 * @param {string} options.v.codec    optional, default V_MPEG4/ISO/ASP
 * @param {number} options.v.duration optional, per frame, in timescale
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
 * @param {function} cb    function(data_array){}
 */
function MKVBuilder(options, cb){
    if(!(this instanceof MKVBuilder)){
        return new MKVBuilder(options, cb);
    }
    if(!cb || typeof cb !== 'function'){
        throw new Error("MKVBuilder: invalid callback");
    }

    var header = [
        fromEBML(0x4286, 1),   // EBMLVersion
        fromEBML(0x42F7, 1),   // EBMLReadVersion
        fromEBML(0x42F2, 4),   // EBMLMaxIDLength
        fromEBML(0x42F3, 8),   // EBMLMaxSizeLength
        fromEBML(0x4282, 'matroska'), // DocType
        fromEBML(0x4287, 2),   // DocTypeVersion
        fromEBML(0x4285, 2),   // DocTypeReadVersion     
    ];

    if(!options.timescale) options.timescale = 1000000;
    if(!options.appmux) options.appmux = "AWS-KINESIS-PUT-MEDIA";
    if(!options.appwrite) options.appwrite = "juliuswwj@gmail.com";

    var segid = Date.now().toString();
    segid = options.appwrite.substr(0, 16 - segid.length) + segid;
    var seginfo = [
        fromEBML(0x73A4, segid), // SegmentUID
        fromEBML(0x2AD7B1, options.timescale),  // timescale
        fromEBML(0x7BA9, options.stream), // title
        fromEBML(0x4D80, options.appmux), // muxing app
        fromEBML(0x5741, options.appwrite), // writing app
    ];

    if(!options.v.codec) options.v.codec = "V_MPEG4/ISO/ASP";
    var vtrack = [ // track info
        fromEBML(0xD7, 1),   // track number
        fromEBML(0x73C5, 1), // track uid
        fromEBML(0x83, 0x01), // track type, video
        fromEBML(0x536E, 'video'), // track name
        fromEBML(0x86, options.v.codec), // codec info
        fromEBML(0xE0, Buffer.concat([   // Video Info
            fromEBML(0xB0, options.v.width),  // width
            fromEBML(0xBA, options.v.height), // height
        ])),
        fromEBML(0x63A2, options.v.data) // private data
    ];
    //if(options.v.duration) vtrack.push( fromEBML(0x23E383, beint(options.v.duration*options.timescale)) ); // Duration
    var tracks = [ fromEBML(0xAE, Buffer.concat(vtrack)) ];
    this.vduration = options.v.duration || 33;
    this.aduration = this.vduration / 2;
    if(options.a){
        if(options.a.duration) this.aduration = options.a.duration;
        if(!options.a.codec) options.a.codec = 'A_AAC';
        if(!options.a.channles) options.a.channles = 2;
        tracks.push(fromEBML(0xAE, Buffer.concat([  // track info
            fromEBML(0xD7, 2),   // track number
            fromEBML(0x73C5, 2), // track uid
            fromEBML(0x83, 0x02), // track type, audio
            fromEBML(0x536E, 'audio'), // track name
            fromEBML(0x86, options.a.codec), // codec info
            //fromEBML(0x23E383, options.a.duration*options.timescale), // Duration
            fromEBML(0xE1, Buffer.concat([  // audio info
                fromEBML(0xB5, fromDouble(options.a.freq)), // sampling freq
                fromEBML(0x9f, options.a.channels), // channels
            ])),
            fromEBML(0x63A2, options.a.data) // private data
        ])));
    }
    cb([
        fromEBML(0x1A45DFA3, Buffer.concat(header)),  // EBML header
        fromEBML(0x18538067, null), // Segment (unknown length)
        fromEBML(0x1549A966, Buffer.concat(seginfo)), // SegmentInfo
        fromEBML(0x1654AE6B, Buffer.concat(tracks)), // tracks
    ]);
    this.cb = cb;
    this.vts = 0;
    this.ats = 0;
    this.tsbase = 0;
    this.data = [];
    this.csize = 0;
}

/**
 * @param {Buffer} data   1 frame data
 * @param {number} type   1: discardable, 8: invisible, 0x80: key frame, 0x100: audio
 */
MKVBuilder.prototype.putFrame = function(data, type){
    if(type == 0x80){ // video I frame, start of cluster
        if(this.csize){
            this.data[0] = fromEBML(0x1F43B675, -this.csize); // cluster, only length mode
            this.cb(this.data);
        }
        this.tsbase = this.vts;
        this.data = [0, 
            fromEBML(0xe7, this.tsbase),  // tmcode
            fromEBML(0xa7, 0)];      // Position - 0 for live
        this.csize = this.data[1].length + this.data[2].length;
    }
    if(this.data.length < 2) return false;  // wait video I frame

    var ts;
    if(type & 0x100){
        ts = this.ats;
        this.ats += this.aduration;
    } else {
        ts = this.vts;
        this.ats = ts;
        this.vts += this.vduration;
    }
    ts -= this.tsbase;

    var block = Buffer.concat([fromEBML(0xa3, -(4 + data.length)), 
        new Buffer([((type>>8)&0xf)+0x81, ts>>8, ts&0xff, type&0xff])]); // track number, sint16 timecode diff, uint8 flags

    //console.log('block', data.length, block);
    this.data.push(block);
    this.data.push(data);
    this.csize += block.length + data.length;
    return true;
};

// a dirty version MKVExtractor, just for testing
var fs = require('fs');
function MKVExtractor(fname){
    this.fd = fs.openSync(fname, 'r');
    this.rptr = 0;
    var hdr = this.ebml();
    if(hdr.id != 0xA45DFA3){
        throw new Error('invalid MKV file');
    }
    this.options = {};
    this.baserptr = this.rptr;
}

MKVExtractor.prototype.reset = function(){
    this.rptr = this.baserptr;
};

MKVExtractor.prototype.getnum = function(){
    var buf = new Buffer(8);
    fs.readSync(this.fd, buf, 0, buf.length, this.rptr);
    var v = toENum(buf);
    this.rptr += buf.epos;
    return v;
};

MKVExtractor.prototype.ebml = function(){
    var id = this.getnum();
    var len = this.getnum();
    if(len <= 0 || id == 0x8538067 || id == 0x654AE6B || id == 0xF43B675 || id == 0x2e) // dont read stream, tracks, cluster, track data
        return {id: id, len: len};
    var data = new Buffer(len);
    fs.readSync(this.fd, data, 0, data.length, this.rptr);
    this.rptr += len;
    return {id: id, data: data};
};

MKVExtractor.prototype.run = function(cb){
    var options = this.options;
    var t = null;

    while(true){
        var e = this.ebml();
        if(e.id == 0) return false;

        if(e.id == 0x6) {
            t.codec = e.data.toString('utf8');
    
        } else if(e.id == 0x23){
            return cb(options, e.data);

        } else if(e.id == 0x67){
            options.tsbase = toNumber(e.data);

        } else if(e.id == 0x57) {
            t = {};
            if(toNumber(e.data) == 1){
                options.v = t;
            } else {
                options.a = t;
            }
        }
        else if(e.id == 0x60) {
            t.width = toNumber(e.data.slice(2, 4));
            t.height = toNumber(e.data.slice(6, 8));
        }
        else if(e.id == 0x61) {
            t.channels = e.data[2]; // 9f 81
            t.freq = toDouble(e.data.slice(5));
        }
        else if(e.id == 0x23a2){
            t.data = e.data;
        }
        else if(e.id == 0x3E383){
            t.duration = toNumber(e.data) / 1000 / 1000; // to ms
        } 
        //else console.log(e);
    }
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
        return new Kinesis(options);
    }

    // check parameters
    if(!options.region){
        throw new Error("Kinesis: invalid options.region");
    }
    if(!options.keyid || options.keyid.length != 20){
        throw new Error("Kinesis: invalid options.keyid");
    }
    if(!options.key || options.key.length != 40){
        throw new Error("Kinesis: invalid options.key");
    }
    if(!options.stream || options.stream.length >= 128){
        throw new Error("Kinesis: invalid options.name");
    }

    if(!options.useragent){
        options.useragent = 'AWS-KINESIS-PUT-MEDIA/0.1.0 ' + process.title + '/' + process.version;
    }

    options.service = 'kinesisvideo';

    this.options = options;
}

function amzdate(){
    return (new Date()).toISOString().replace(/-|:|\.\d+/g, '');
}

function hmac(key, data, encoding)
{
    var hmac = crypto.createHmac('sha256', key);
    hmac.update(new Buffer(data, 'utf8'));
    return hmac.digest(encoding);
}

function hash(data)
{
    var h = crypto.createHash('sha256');
    h.update(new Buffer(data, 'utf8'));
    return h.digest('hex');
}

/**
 * 
 * @param {object} req 
 * @param {string} txt 
 * @param {object} options 
 */
function genAWS4Auth(req, txt, options)
{
    var algorithm = 'AWS4-HMAC-SHA256';
    var fields = ['content-type', 'connection', 'host', 'transfer-encoding', 'user-agent', 
        'x-amz-date', 'x-amzn-fragment-acknowledgment-required', 'x-amzn-fragment-timecode-type', 
        'x-amzn-producer-start-timestamp', 'x-amzn-stream-name'];
    
    // build canonicalRequest
    // assume empty query string
    var str = [req.method, req.path, ''];
    var signed = [];
    var i = 0;
    for(; i < fields.length; i++){
        var n = fields[i];
        var v = req.headers[n];
        if(! v ) continue;
        signed.push(n);
        str.push(n + ':' + v);
    }
    str.push('');
    str.push(signed.join(';'));
    str.push(hash(txt)); // body
    str = str.join('\n');

    //console.log(str);

    // datetime string for key generation
    var datetime = req.headers['x-amz-date'];
    var date = datetime.substr(0, 8);

    // get key from cache
    var credential = [date, options.region, options.service, 'aws4_request'];
    var cachename = credential.join('/');
    var key = options[cachename];
    if(!key){
        key = 'AWS4' + options.key;
        i = 0;
        for(i = 0; i < credential.length; i++){
            key = hmac(key, credential[i]);
        }
        options[cachename] = key;
    }
    //console.log(key.toString('hex'));

    // calculate auth line
    str = [algorithm, datetime, cachename, hash(str)].join('\n');
    //console.log(str);
    str = algorithm + ' Credential=' + options.keyid + '/' + cachename + 
        ', SignedHeaders=' + signed.join(';') + 
        ', Signature=' + hmac(key, str, 'hex');
    req.headers.Authorization = str;
}


/**
 * @param {function} cb
 */
Kinesis.prototype.getEndPoint = function(cb){
    if(!cb || typeof cb !== 'function'){
        throw new Error("getEndPoint: invalid callback");
    }
    var txt = JSON.stringify({APIName:'PUT_MEDIA', StreamName:this.options.stream}) + '\n';
    var host = this.options.service + '.' + this.options.region + '.amazonaws.com';
    var options = {
        method: 'POST',
        path: '/getDataEndpoint',
        host: host,
        headers: {
            'Accept': '*/*',
            'user-agent': this.options.useragent,
            'host': host,
            'x-amz-date': amzdate(),
            'Content-Length': txt.length
        },
    };
    genAWS4Auth(options, txt, this.options);
    // options.headers['Content-Type'] = 'application/x-www-form-urlencoded'; // added by curl, no use

    var req = https.request(options, function(res){
        var body = '';
        res.on('data', function(data){
            body += data.toString('utf8');
        });
        res.on('end', function(){
            try{
                cb(null, JSON.parse(body));
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
};

function putMedia(options, url, cb, cb2){
    // parse https://s-4010bf70.kinesisvideo.us-west-2.amazonaws.com
    //var http = require('http');
    //var host = 'localhost';
    var host = url.substring( url.indexOf('//')+2 );  
    var opt = {
        method: 'POST',
        path: '/putMedia',
        host: host,
        //port: 8000,
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
        },
    };

    genAWS4Auth(opt, '', options);

    var req = https.request(opt, function(res){
        var ec = 0;
        res.on('data', function(data){
            data = data.toString('utf8');
            var n = data.indexOf('\n');
            cb(null, 'message', data.substring(0, n));
        });
        res.on('end', function(){
            cb(null, 'end');
        });
        cb(null, 'connect');
        cb2();
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

    var options = this.options;
    var req = null;
    var dq = [];
    var busy = false;

    function dosend(){
        if(busy || dq.length == 0 || !req) return;
        options.req = req;
        busy = true;

        function send(){
            while(true){
                if(dq.length == 0){
                    busy = false;
                    break;
                }
                var d = dq.shift();
                var b = req.write(d);
                //console.log('req.write', d.length, 'return', b);
                if( !b ){
                    req.once('drain', send);
                    break;
                } 
            }
        }
        send();
    }

    this.mkv = new MKVBuilder(this.options, function(data){
        //console.log('mkvpush', data.length);
        dq = dq.concat(data);
        dosend();
    });


    // run web api
    this.getEndPoint(function(err, ob){
        if(err) { 
            cb(err); 
            return; 
        }
        if(!ob.DataEndpoint){
            cb(ob);
            return; 
        }
        try {
            console.log('getEndPoint', ob);
            req = putMedia(options, ob.DataEndpoint, cb, dosend);
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
    //console.log('putFrame', data.length, type);
    this.mkv.putFrame(data, type);
};

Kinesis.prototype.end = function(){
    if(this.options && this.options.req) {
        this.options.req.end();
        this.options.req = null;
    }
};

module.exports = {
    MKVExtractor: MKVExtractor,
    MKVBuilder: MKVBuilder,
    Kinesis: Kinesis,
    genAWS4Auth: genAWS4Auth,
};
