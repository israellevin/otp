(function(){'use strict';

// Error catcher.
function typeproof(success, error){
    try{
        return success();
    }catch(e){
        if(e instanceof TypeError){
            if(typeof error === 'function') return error();
        }else throw e;
    }
}

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

// A "relatively thread safe" sorted set of unique items.
function SortedSet(keyname){
    this.items = [];

    function bindexof(sortedarray, key){
        if(sortedarray.length === 0) return [false, 0];
        var minidx = 0, maxidx = sortedarray.length - 1, mididx, midkey;
        while(true){
            mididx = (minidx + maxidx) / 2 | 0;
            midkey = sortedarray[mididx][keyname];
            if(key === midkey){
                return [true, mididx];
            }else if(key > midkey){
                minidx = mididx + 1;
            }else{
                maxidx = mididx - 1;
            }
            if(minidx > maxidx) return [false, minidx];
        }
    }

    this.add = function(item){
        var pos = bindexof(this.items, item[keyname]);
        if(pos[0] === true) return this.items[pos[1]] = item;
        else return this.items.splice(pos[1], 0, item) && item;
    };

    this.removebykey = function(key){
        var pos = bindexof(this.items, key);
        if(pos[0]) this.items.splice(pos[1], 1);
    };

    this.keys = function(){
        return map(this.items, function(item){return item[keyname];});
    };

    this.each = function(func){
        each(this.keys(), function(key){
            var pos = bindexof(this, key);
            if(pos[0]) return func(this[pos[1]]);
        }.bind(this.items));
    };
}

// A dictionary that holds a sorted array of values.
function SortedDict(keyname){
    this.set = new SortedSet(keyname);
    this.dict = {};
    this.add = function(item){
        this.dict[item[keyname]] = this.set.add(item);
    };

    this.getor = function(key){
        var item = this.dict[key];
        if(typeof item === 'undefined'){
            item = {};
            item[keyname] = key;
            this.add(item);
        }
        return item;
    }
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
    return function(dict, keyname, reverse){
        var sorted = new SortedSet(keyname);
        eachval(dict, function(item){
            sorted.add(item);
        });
        if(reverse) return sorted.items.reverse();
        return sorted.items;
    };

// A secrets service to serve us the server injected secrets.
// TODO Separate viewers service?
}).service('secrets', ['$window', '$http', function(
    $window, $http
){
    this.index = new SortedDict('id');
    this.get = function(id){return this.index.dict[id];};
    this.keys = function(){return this.index.set.keys();};
    this.viewers = {};

    // Add a secret, linking it to its relatives.
    // FIXME A bit too long for my taste.
    this.add = function(rawsecret){
        var secret = this.index.getor(rawsecret.id);

        secret.service = this;
        secret.id = rawsecret.id;
        secret.time = rawsecret.time;
        secret.author = this.viewers[rawsecret.authorid];

        secret.viewers = {
            maincast: new SortedSet('id'),
            peepers: new SortedSet('id')
        };
        secret.authparents = {};
        eachval(rawsecret.viewers, function(rawviewerslist, authparentid){
            var dictlist = new SortedSet('id');
            var flatlist = secret.viewers.peepers;
            if(secret.id >= authparentid){
                flatlist = secret.viewers.maincast;
                if(rawviewerslist.indexOf(uid) > -1) secret.amimaincast = true;
            }
            each(rawviewerslist, function(rawviewerid){
                dictlist.add(flatlist.add(this.viewers[rawviewerid]));
            }.bind(this));
            secret.authparents[authparentid] = dictlist;
        }.bind(this));

        if(typeof rawsecret.parentid === 'number'){
            secret.parent = this.index.getor(rawsecret.parentid);

            // Legitimacy check, since not all children are born alike.
            if(secret.authparents[secret.parent.id]) secret.legitimate = true;
            else secret.legitimate = false;
        }

        secret.children = map(rawsecret.childids, function(childid){
            return this.index.getor(childid);
        }.bind(this));

        secret.authchildren = map(rawsecret.authchildids, function(authchildid){
            return this.index.getor(authchildid);
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
            if(rawviewer.lastseen > this.lastupdate){
                this.lastupdate = rawviewer.lastseen;
            }
            this.viewers[rawviewer.id] = rawviewer;
            this.viewers[rawviewer.id].lastseen *= 1000;
        }.bind(this));
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
            params: {
                afterid: this.latestsecretid,
                lastupdate: this.lastupdate
            }
        }).success(function(data){
            this.load(data);
            callback(data);
        }.bind(this)).error(function(data){
            console.log('server error:', arguments);
        });
    };

    // Load the secrets the server injected into the page.
    this.lastupdate = 0;
    this.load({
        rawsecrets: $window.rawsecrets,
        rawviewers: $window.rawviewers,
        latestsecretid: $window.latestsecretid
    });

// A controller for displaying threads.
}]).controller('threads', ['$scope', '$timeout', 'secrets', function(
    $scope, $timeout, secrets
){
    var groups = {
        viewed: new SortedSet('id'),
        ripe: new SortedSet('id'),
        hidden: new SortedSet('id'),
        subs: new SortedSet('id')
    };

    // Create a thread object from a root secret.
    function Thread(rootsecret){
        this.id = rootsecret.id;
        this.rootsecret = rootsecret;
        this.latestsecretid = this.rootsecret.id;
        this.viewers = {
            maincast: new SortedSet('id'),
            peepers: new SortedSet('id')
        };

        this.members = new SortedSet('id');
        this.add = function(members){
            each(members, function(member){
                member.thread = this;
                this.members.add(member);
                if(member.id > this.latestsecretid){
                    this.latestsecretid = member.id;
                }
                each(['maincast', 'peepers'], function(listkey){
                    member.viewers[listkey].each(function(viewer){
                        this.viewers[listkey].add(viewer);
                    }.bind(this));
                }.bind(this));
            }.bind(this));
        };

        // Get a thread's name.
        this.getname = function(){
            var name = this.rootsecret.body;
            if(name.length <= 20) return name;
            try{
                name = name.match(/^[^\n]{0,19}($|[\n\s])/)[0];
            }catch(e){
                if(e instanceof TypeError){
                    name = name.slice(0, 19);
                }else throw e;
            }
            return name + '…';
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
                if(parent && this.rootsecret.legitimate){
                    type = 'subs';
                    parent.add(this.members.items);
                }else{
                    type = 'viewed';
                    this.name = this.getname();
                }
            }else if(
                this.rootsecret.amimaincast ||
                (this.rootsecret.parent && this.rootsecret.parent.view === true)
            ) type = 'ripe';
            else eachval(
                this.rootsecret.authparents,
                function(viewerslist, secretid){
                    if(secrets.get(secretid).view === true){
                        return (type = 'ripe') && false;
                    }
                }.bind(this)
            );

            // Move the thread if its type has changed.
            var pos;
            if(!this.type || this.type !== type){
                if(this.type){
                    groups[this.type].removebykey(this.id);
                }
                this.type = type;
                groups[type].add(this);
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
                if(child.legitimate) members = members.concat(
                    threadsecrets(child, isunviewed)
                );
            });
            return members;
        }

        // Add all threaded descendants of rootsecret.
        this.add(threadsecrets(this.rootsecret));
        this.sort();
    }

    $scope.viewed = groups.viewed.items;
    $scope.ripe = groups.ripe.items;
    $scope.viewers = secrets.viewers;
    $scope.data = {};


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
                    groups.hidden.each(function(nthread){nthread.sort();});
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
            $timeout($scope.getnew, 1000);
        });
    };
    $scope.getnew();

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
