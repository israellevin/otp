(function(){'use strict';

// Helpers
function iterate(array, func, thisarg){
    if(thisarg) func = func.bind(thisarg);
    for(var idx = 0, len = array.length; idx < len; idx++){
        if(func(array[idx], idx) === false) break;
    }
}
function jsonp(url, data, callback){
    $.ajax({
        url: url,
        dataType: 'jsonp',
        data: data,
        success:function(data){
            if(data && typeof data.error === 'string') log(data);
            callback(data);
        },
        error:function(){
            log('Unable to retrieve ' + url);
        }
    });
}
function nicedate(d){
    if('undefined' === typeof d) d = new Date();
    var padded = $.map(
        [
            d.getMonth() + 1,
            d.getDate(),
            d.getHours(),
            d.getMinutes(),
            d.getSeconds()
        ],
        function(c){
            return (c < 10 ? '0' : '') + c;
        }
    );
    padded.unshift(d.getFullYear());
    return padded.slice(0, 3).join('-') + ' ' +  padded.slice(3).join(':');
}
var log = console.log;

// Turn a server injected secret into a usefull, displayable object.
function Secret(secret){
    $.extend(this, secret);
}
Secret.prototype.withdiv = function(callback){
    // If the secret has a body, we create the div and hand it to the callback.
    if(typeof this.body === 'string'){
        return callback(
            $('<div>').addClass('secret').append(
                $('<h2>').text(this.name),
                $('<p>').text(this.body)
            )
        );
    }
    // Otherwise, it is an unviewed secret, so we fetch it from the server.
    var secret = this;
    jsonp('/secret', {
        id: this.id
    }, function(newsecret){
        if(typeof newsecret.body === 'string'){
            $.extend(secret, newsecret).withdiv(callback);
            secret.thread.update(secret.id);
        }
    });
};

// Turn a server injected list of secrets into an indexed, linked object.
function Secrets(secrets){
    this.dict = {};
    this.array = secrets.map(function(secret){
        return this.dict[secret.id] = new Secret(secret);
    }, this);
    iterate(this.array, function(secret){
        if(secret.parentid){
            secret.parent_ = this.dict[secret.parentid];
        }
        secret.children_ = secret.childids.map(function(childid){
            return this.dict[childid];
        }, this);
    }, this);
}

// Take a root ID and an indexed, linked list of possible members, and turn it
// into a linked object.
function Thread(rootid, secrets){
    this.root = secrets[rootid];
    this.listeners = [];
    this.secrets = {};

    // Recursively gather thread related information.
    function accumulatesecrets(secret){
        var ids = [[secret.id], []];
        this.secrets[secret.id] = secret;
        secret.thread = this;
        if(typeof secret.body !== 'string'){
            ids[1].push(secret.id);
        }

        iterate(secret.children_, function(child){
            iterate(accumulatesecrets.call(this, child), function(array, idx){
                ids[idx] = ids[idx].concat(array);
            });
        }, this);
        return ids
    }
    this.secretids = accumulatesecrets.call(this, this.root);
    this.unviewedids = this.secretids[1];
    this.secretids = this.secretids[0];
    this.gettarget();
}

// Get thread's target (the secret to show when it's clicked).
Thread.prototype.gettarget = function(){
    if(this.unviewedids.length > 0){
        this.oldestunviewedid = Math.min.apply(null, this.unviewedids);
        if(this.secrets[this.oldestunviewedid]){
            this.targetid = this.secrets[this.oldestunviewedid].parentid;
        }
    }
    if(!this.targetid) this.targetid = Math.max.apply(null, this.secretids);
    return this.target = this.secrets[this.targetid];
};

// Update target after a secret was viewed and trigger update event.
Thread.prototype.update = function(viewed){
    if(typeof viewed !== 'undefined'){
        this.unviewedids.splice(this.unviewedids.indexOf(viewed.id), 1);
    }
    this.gettarget();
    iterate(this.listeners, function(listener){listener(this);}, this);
};

// A wrapper for holding a sorted, self filling array of threads.
function Threads(secrets){
    this.threadsarray = [];
    var ids = secrets.array.map(function(secret){
        return secret && secret.id;
    }).sort();
    var thread;
    while(ids.length > 0){
        thread = new Thread(ids[0], secrets.dict);
        iterate(thread.secretids, function(id){
            var pos = ids.indexOf(id);
            if(pos > -1) ids.splice(pos, 1);
        });
        this.add(thread);
    }

    return this;
}

// Threads with unviewed secrets come first, sorted by oldest unviewed secret,
// then fully viewed threads sorted by newest (viewed) secret.
Threads.prototype.add = function(thread){
    var threads = this;
    var threadsarray = this.threadsarray;
    var place = false;
    iterate(threadsarray, function(existingthread, idx){
        if(thread.unviewedids.length > 0){
            if(existingthread.unviewedids.length > 0){
                if(thread.oldestunviewedid < existingthread.oldestunviewedid){
                    place = idx;
                    return false;
                }
            }else{
                place = idx;
                return false;
            }
        }else{
            if(existingthread.unviewedids.length === 0){
                if(thread.targetid > existingthread.targetid){
                    place = idx;
                    return false;
                }
            }
        }
        return true;
    });
    if(place === false) place = threadsarray.length;
    threadsarray.splice(place, 0, thread);

    // Update list on thread update.
    thread.listeners.push(function(){
        threadsarray.splice(threadsarray.indexOf(thread), 1);
        threads.add(thread);
        threads.draw();
    });

    return this;
};

function rprtrds(threads){
    return threads.threadsarray.reduce(function(prv, cur){
        return '-' + prv + '-' + cur.root.name;
    }, '');
}

// Draw the listed threads into a div and bind their events.
// TODO This will have cool animations for live update.
Threads.prototype.draw = function(threadsdiv, secretsdiv){
    var threads = this;
    if(threadsdiv) this.threadsdiv = threadsdiv;
    if(secretsdiv) this.secretsdiv = secretsdiv;

    this.threadsdiv.empty().append(this.threadsarray.map(function(thread){
        return $('<div>').addClass('thread' + (
            (thread.unviewedids.length > 0) ? ' unviewed' : ''
        )).append(
            $('<p>').text(thread.root.name)
        ).click(function(evt){
            threads.secretsdiv.empty();
            for(
                var secret = thread.secrets[thread.targetid];
                secret;
                secret = secret.parent_
            )secret.withdiv(function(div){
                threads.secretsdiv.prepend(div);
            });
        });
    }));
    return this;
};

function Composer(div){
    $('<textarea>').keyup(function(evt){
        if(evt.ctrlKey && 13 === evt.which) log($(this).val());
    }).appendTo(div).focus();
}

// On ready.
$(function(){
    new Threads(new Secrets(secrets)).draw(
        $('#threads'), $('#secrets')
    );

    new Composer($('#compose'));

    $('#nojs').remove();
});
}());
