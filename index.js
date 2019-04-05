'use strict'
var https = require('https');
var crypto = require('crypto');

function beint(n){
    if(n & 0xff000000){
        var b = new Buffer(4);
        b.writeUInt32BE(n, 0);
        return b;
    } 
    if(n & 0xff0000){
        var b = new Buffer(3);
        b[0] = n>>16;
        b.writeUInt16BE(n&0xffff, 1);
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
    var vtrack = [ // track info
        ebml(0xD7, beint(1)),   // track number
        ebml(0x73C5, beint(1)), // track uid
        ebml(0x83, beint(0x01)), // track type, video
        ebml(0x536E, new Buffer('video')), // track name
        ebml(0x86, new Buffer(options.v.codec)), // codec info
        ebml(0xE0, Buffer.concat([   // Video Info
            ebml(0xB0, beint(options.v.width)),  // width
            ebml(0xBA, beint(options.v.height)), // height
        ])),
        ebml(0x63A2, options.v.data) // private data
    ];
    //if(options.v.duration) vtrack.push( ebml(0x23E383, beint(options.v.duration*options.timescale)) ); // Duration
    var tracks = [ ebml(0xAE, Buffer.concat(vtrack)) ];
    this.vduration = options.v.duration || 33;
    this.aduration = this.vduration / 2;
    if(options.a){
        if(options.a.duration) this.aduration = options.a.duration;
        if(!options.a.codec) options.a.codec = 'A_AAC';
        if(!options.a.channles) options.a.channles = 2;
        tracks.push(ebml(0xAE, Buffer.concat([  // track info
            ebml(0xD7, beint(2)),   // track number
            ebml(0x73C5, beint(2)), // track uid
            ebml(0x83, beint(0x02)), // track type, audio
            ebml(0x536E, new Buffer('audio')), // track name
            ebml(0x86, new Buffer(options.a.codec)), // codec info
            //ebml(0x23E383, beint(options.a.duration*options.timescale)), // Duration
            ebml(0xE1, Buffer.concat([  // audio info
                ebml(0xB5, bedouble(options.a.freq)), // sampling freq
                ebml(0x9f, beint(options.a.channels)), // channels
            ])),
            ebml(0x63A2, options.a.data) // private data
        ])));
    }
    cb([
        ebml(0x1A45DFA3, Buffer.concat(header)),  // EBML
        beint(0x18538067), new Buffer([0xff]), // Segment (unknown length)
        ebml(0x1549A966, Buffer.concat(seginfo)), // SegmentInfo
        ebml(0x1654AE6B, Buffer.concat(tracks)), // tracks
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
            this.data[0] = Buffer.concat([beint(0x1F43B675), benum(this.csize)]); // cluster
            this.cb(this.data);
        }
        this.tsbase = this.vts;
        this.data = [0, 
            ebml(0xe7, beint(this.tsbase)),  // tmcode
            ebml(0xa7, new Buffer(1))];      // Position - 0 for live
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

    var block = Buffer.concat([beint(0xa3), benum(4 + data.length),
        benum( ((type>>8)+1) & 0xf), // track number
        new Buffer([ts>>8, ts&0xff, type&0xff])]); // sint16 timecode diff, uint8 flags
    //console.log('block', data.length, block);
    this.data.push(block);
    this.data.push(data);
    this.csize += block.length + data.length;
    return true;
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

/**
 * 
 * @param {string} halg 
 * @param {Buffer} key 
 */
function createHmac(halg, key){
    if(crypto.createHmac)return crypto.createHmac(halg, key);
    var data = new Buffer(0);
    key = new Buffer(key);

    function hash2(a, b){
        var h = crypto.createHash(halg);
        h.update(a);
        h.update(b);
        return h.digest();
    }
    return {
        update: function(v){
            data = Buffer.concat([data, v]);
        },
        digest: function(encoding){
            var l = key.length;
            var ikey = Buffer.alloc( (l+63)&0xffffc0, 0x36);  // HMAC-SHA256 uses 64 bytes pad
            var okey = Buffer.alloc( (l+63)&0xffffc0, 0x5c);
            for(var i = 0; i < l; i++){
                ikey[i] ^= key[i];
                okey[i] ^= key[i];
            }
            var b = hash2(okey, hash2(ikey, data));
            if(encoding) return b.toString(encoding);
            return b;
        }
    };
}

function hmac(key, data, encoding)
{
    var hmac = createHmac('sha256', key);
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
    for(var i = 0; i < fields.length; i++){
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
        var key = 'AWS4' + options.key;
        for(var i = 0; i < credential.length; i++){
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
    req.headers['Authorization'] = str;
};


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
        res.setEncoding('utf8');
        var body = '';
        res.on('data', function(data){
            body += data;
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
}

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
            'Expect': '100-continue'
        },
    };

    genAWS4Auth(opt, '', options);

    var req = https.request(opt, function(res){
        res.setEncoding('utf8');
        res.on('data', function(data){
            var n = data.indexOf('\r\n');
            cb(null, 'message', data.slice(0, n));
        });
        res.on('end', function(){
            cb(null, 'end');
        })
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
                if( !req.write(d) ){
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
        try {
            // console.log('getEndPoint', ob);
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
    Kinesis: Kinesis,
    MKVBuilder: MKVBuilder,
    genAWS4Auth: genAWS4Auth,
};
