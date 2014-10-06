// FIXME debug.
var log  = console.log;

(function(){'use strict';

// Iterators.
function each(arr, func){
    for(var idx = 0, len = arr.length; idx < len; idx++){
        if(func(arr[idx], idx) === false) break;
    }
}
function map(arr, func){
    var results = [];
    each(arr, function(item){
        var result = func(item);
        if(typeof result !== 'undefined') results.push(result);
    });
    return results;
}
function eachval(dictionary, func){
    each(Object.keys(dictionary), function(key){
        return func(dictionary[key], key);
    });
}

// A dictionary that holds a sorted array of values.
function SortDict(){
    this.keys = [];
    this.dict = {};
    this.get = function(id){return this.dict[id];};
    this.getbypos = function(pos){return this.dict[this.keys[pos]];};

    function binsearch(arr, val){
        var minidx = 0, maxidx = arr.length - 1, idx;
        while(minidx <= maxidx){
            idx = (minidx + maxidx) / 2 | 0;
            if(arr[idx] < val) minidx = idx + 1;
            else maxidx = idx - 1;
        }
        return minidx;
    }

    this.add = function(id, item){
        if(!this.dict[id]) this.keys.splice(binsearch(this.keys, id), 0, id);
        return this.dict[id] = item;
    };

    this.getor = function(id){return this.get(id) || this.add(id, {});};

    this.each = function(callback){
        each(this.keys, function(key){
            return callback(this.get(key), key);
        }.bind(this));
    };

    this.toarray = function(){
        var arr = [];
        this.each(function(member){
            arr.push(member);
        });
        return arr;
    };
}

// Get that angular magick flowing.
angular.module('otp', []).

// A filter for rendering markdown.
// FIXME Sanitize!
filter('markdown', ['$sce', '$window', function($sce, $window){
    return function(markdown){
        return $sce.trustAsHtml($window.marked(markdown));
    };

// A filter for ordering dictionaries.
}]).filter('dictorderBy', function(){
    return function(dict, key, reverse){
        var sorted = new SortDict();
        eachval(dict, function(value, id){
            sorted.add(value[key], value);
        });
        sorted = sorted.toarray();
        if(reverse) return sorted = sorted.reverse();
        return sorted;
    };

// A secrets service to serve us the server injected secrets.
}).service('secrets', ['$window', '$http', function(
    $window, $http
){
    this.index = new SortDict();
    this.get = function(id){return this.index.get(id);};
    this.keys = function(id){return this.index.keys.slice();};
    this.viewers = {};

    // Add a secret, linking it to its relatives.
    this.add = function(rawsecret){
        var secret = this.index.getor(rawsecret.id);

        secret.service = this;
        secret.id = rawsecret.id;
        secret.time = rawsecret.time;

        secret.author = this.viewers[rawsecret.authorid];
        if(typeof rawsecret.parentid === 'number')
            secret.parent = this.index.getor(rawsecret.parentid);

        secret.children = map(rawsecret.childids, function(childid){
            return this.index.getor(childid);
        }.bind(this));

        secret.viewers = {};
        each(Object.keys(rawsecret.viewers), function(key){
            secret.viewers[key] = map(rawsecret.viewers[key], function(id){
                return this.viewers[id];
            }.bind(this));
        }.bind(this));

        if(typeof rawsecret.body === 'string'){
            secret.body = rawsecret.body;
            secret.view = true;
        // Prepare a function to fetch the unviewed secret from the server.
        }else secret.view = function(callback){
            $http({
                url: '/secrets/' + secret.id,
                method: 'GET',
            }).success(function(data){
                callback(this.service.add(data));
            }.bind(this)).error(function(data){
                console.log('server error:', arguments);
            });
        };
        return secret;
    };

    // Load a bunch of secrets and viewers and such.
    this.load = function(data){
        each(data.rawviewers, function(rawviewer){
            this[rawviewer.id] = rawviewer;
            this[rawviewer.id].lastseen = new Date(rawviewer.lastseen);
        }.bind(this.viewers));
        each(data.rawsecrets, function(rawsecret){
            this.add(rawsecret);
        }.bind(this));
        this.latestsecretid = data.latestsecretid;
    };

    // Update from the server.
    this.update = function(callback){
        $http({
            url: '/secrets',
            method: 'GET',
            params: {afterid: (this.latestsecretid || 0)}
        }).success(function(data){
            this.load(data);
            callback(data);
        }.bind(this)).error(function(data){
            console.log('server error:', arguments);
        });
    };

    // Load the secrets the server injected into the page.
    this.load({
        rawsecrets: $window.rawsecrets,
        rawviewers: $window.rawviewers,
        latestsecretid: $window.latestsecretid
    });

// A controller for displaying threads.
}]).controller('threads', ['$scope', '$interval', 'secrets', function(
    $scope, $interval, secrets
){
    $scope.viewed = [];
    $scope.ripe = [];
    $scope.hidden = [];
    $scope.subs = [];
    $scope.data = {};
    $scope.viewers = secrets.viewers;

    // Create a thread object from a root secret.
    function Thread(rootsecret){
        this.rootsecret = rootsecret;
        this.latestsecretid = this.rootsecret.id;

        // FIXME Replace with something more specific than SortDict?
        this.members = new SortDict();
        this.add = function(members){
            each(members, function(member){
                member.thread = this;
                this.members.add(member.id, member);
                if(member.id > this.latestsecretid){
                    this.latestsecretid = member.id;
                }
            }.bind(this));
        };

        // Get a thread's name.
        this.getname = function(){
            try{
                return this.rootsecret.body.match(/^[^\n]{0,20}($|[\n\s])/)[0];
            }catch(e){
                if(e instanceof TypeError){
                    return this.rootsecret.body.slice(0,19) + '…';
                }else throw e;
            }
        };

        // Get a thread's parent thread, if it exists.
        this.getparent = function(){
            var parent;
            try{
                return this.rootsecret.parent.thread;
            }catch(e){
                if(!e instanceof TypeError) throw e;
                return false;
            }
        }

        // Sort a thread as viewed, ripe, hidden or subthread.
        this.sort = function(){
            var type = 'hidden', parent = null;
            if(this.rootsecret.view === true){
                parent = this.getparent();
                if(parent){
                    type = 'subs';
                    parent.add(this.members.toarray());
                }else{
                    type = 'viewed';
                    this.name = this.getname();
                }
            }else if(this.rootsecret.parent){
                if(this.rootsecret.parent.view === true) type = 'ripe';
                else type = 'hidden';
            }else eachval(
                this.rootsecret.viewers,
                function(viewerslist, secretid){
                    if(secretid <= this.rootsecret.id){
                        if(viewerslist.indexOf(secrets.viewers[uid]) > -1){
                            return (type = 'ripe') && false;
                        }
                    }else{
                        if(secrets.get(secretid).view === true){
                            return (type = 'ripe') && false;
                        }
                    }
                }.bind(this)
            );

            // Move the thread if its type has changed.
            var pos;
            if(!this.type || this.type !== type){
                if(this.type){
                    pos = $scope[this.type].indexOf(this);
                    if(pos > -1) $scope[this.type].splice(pos, 1);
                }
                this.type = type;
                $scope[type].unshift(this);
            }
        };

        // Recursively gather a thread of secrets from a root secret.
        function threadsecrets(secret, isunviewed){
            if(typeof isunviewed === 'undefined'){
                isunviewed = (typeof secret.body === 'undefined');
            }else if((typeof secret.body === 'undefined') !== isunviewed){
                return [];
            }
            var members = [secret];
            each(secret.children, function(child){
                members = members.concat(threadsecrets(child, isunviewed));
            });
            return members;
        }

        // Add all threaded descendants of rootsecret.
        this.add(threadsecrets(this.rootsecret));
        this.sort();

        // Make a flat viewers list.
        // TODO aggregate viewers from all members?
        var viewers = [];
        eachval(this.rootsecret.viewers, function(viewerids){
            each(viewerids, function(viewerid){
                if(viewers.indexOf(viewerid) < 0) viewers.push(viewerid);
            });
        });
        this.viewers = viewers;
    }

    // Request all members of a thread and refresh threads when they arrive.
    $scope.viewthread = function(thread){
        var counter = 0;
        thread.members.each(function(member){
            counter++;
            member.view(function(newmember){
                var target, pos;
                counter--;
                if(counter === 0){
                    thread.sort();
                    each($scope.hidden, function(thread){thread.sort();});
                    $scope.data.activethread = thread.rootsecret.thread;
                }
            });
        });
    };

    // Pull threads out of a checklist of IDs.
    function threadchecklist(checklist){
        while(checklist.length > 0){
            new Thread(secrets.get(checklist.shift())).members.each(
                function(member){
                    var pos = checklist.indexOf(member.id);
                    if(pos > -1) checklist.splice(pos, 1);
                }
            );
        }
    }
    threadchecklist(secrets.keys());
    if($scope.viewed.length > 0) $scope.data.activethread = $scope.viewed[0];
    else $scope.data.activethread = null;

    $scope.getnew = function(callback){
        secrets.update(function(data){
            threadchecklist(map(data.rawsecrets, function(rawsecret){
                return rawsecret.id;
            }));
            if(typeof callback === 'function') callback(data);
        });
    };
    $interval($scope.getnew, 100000);

    // FIXME Some debug binds here.
    window.s = secrets;
    window.v = $scope.viewed;
    window.r = $scope.ripe;
    window.h = $scope.hidden;

    // FIXME find me a place.
    $scope.nojsstyle = 'display: none';

// A controller for composing secrets.
}]).controller('composer', ['$scope', '$http', 'secrets', function(
    $scope, $http, secrets
){
    // FIXME directivise this shit. Or maybe just let G do it properly.
    $scope.authparents = [];
    $scope.addauthparent = function(){
        $scope.authparents.push($scope.authparentid);
        $scope.authparentid = '';
    };

    $scope.authchildren = [];
    $scope.addauthchild = function(){
        $scope.authchildren.push($scope.authchildid);
        $scope.authchildid = '';
    };

    $scope.viewers = [];
    $scope.addviewer = function(){
        $scope.viewers.push($scope.viewerid);
        $scope.viewerid = '';
    };

    $scope.post = function(){
        $http({
            url: '/post',
            method: 'POST',
            params: {
                body: $scope.body,
                parentid: $scope.parentid,
                'authparentids[]': $scope.authparents,
                'authchildids[]': $scope.authchildren,
                'viewerids[]': $scope.viewers

            }
        }).success(function(data){
            $scope.body = '';
            $scope.parentid = '';
            $scope.authparents = [];
            $scope.authchildren = [];
            $scope.viewers = [];
            $scope.getnew(function(){
                $scope.data.activethread = secrets.get(this).thread;
            }.bind(data));
        }).error(function(data){
            console.log('server error:', arguments);
        });
    };
}]);

}());
