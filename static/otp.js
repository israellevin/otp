// FIXME debug.
var log  = console.log;

(function(){'use strict';

// Iterators.
function each(arr, func, thisarg){
    if(thisarg) func = func.bind(thisarg);
    for(var idx = 0, len = arr.length; idx < len; idx++){
        if(func(arr[idx], idx) === false) break;
    }
}
function map(arr, func, thisarg){
    if(thisarg) func = func.bind(thisarg);
    var results = [];
    each(arr, function(item){
        var result = func(item);
        if(typeof result !== 'undefined') results.push(result);
    });
    return results;
}
function eachval(dictionary, func, thisarg){
    if(thisarg) func = func.bind(thisarg);
    each(Object.keys(dictionary), function(key){
        return func(dictionary[key], key);
    });
}

// Helpers.
function copy(obj, extension){
    var copy = obj.constructor();
    for(var attr in obj){
        if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
    }
    if(typeof extension === 'object') for(var attr in extension){
        if (extension.hasOwnProperty(attr)) copy[attr] = extension[attr];
    }
    return copy;
}
function SortDict(){
    this.keys = [];
    this.dict = {};

    this.get = function(id){return this.dict[id];};
    this.getbypos = function(pos){return this.dict[this.keys[pos]];};
    this.remove = function(id){
        var pos = this.keys.indexOf(id);
        if(pos === -1) return false;
        this.keys.splice(pos, 1);
        return delete this.dict[id];
    };

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

    this.each = function(callback, thisarg){
        if(thisarg) callback = callback.bind(thisarg);
        each(this.keys, function(key){
            return callback(this.get(key), key);
        }, this);
    };
}

// A secrets service to enhance and serve the server injected secrets.
angular.module('otp', []).service('secrets', ['$window', '$http', function(
    $window, $http
){
    var viewers = {};
    each($window.rawviewers, function(rawviewer){
        viewers[rawviewer.id] = rawviewer;
    });
    this.me = viewers[$window.uid];

    this.index = new SortDict();
    this.add = function(rawsecret){
        var secret = this.index.getor(rawsecret.id);

        secret.service = this;
        secret.id = rawsecret.id;
        secret.time = rawsecret.time;

        secret.author = viewers[rawsecret.authorid];
        if(typeof rawsecret.parentid === 'number')
            secret.parent = this.index.getor(rawsecret.parentid);

        secret.children = map(rawsecret.childids, function(childid){
            return this.index.getor(childid);
        }, this);

        secret.viewers = {};
        each(Object.keys(rawsecret.viewers), function(key){
            secret.viewers[key] = map(rawsecret.viewers[key], function(id){
                return viewers[id];
            });
        });

        if(typeof rawsecret.body === 'string'){
            secret.body = rawsecret.body;
            secret.view = true;
        }else secret.view = function(callback){
            $http({
                url: 'secret',
                method: 'post',
                params: {id: secret.id},
            }).success(function(data){
                callback(this.service.add(data));
            }.bind(this)).error(function(data){
                console.log('server error:', arguments);
            });
        };
        return secret;
    };

    each($window.rawsecrets, function(rawsecret){
        this.add(rawsecret);
    }, this);

    this.get = function(id){return this.index.get(id);};
    this.keys = function(id){return this.index.keys.slice();};

// A controller for displaying threads.
}]).controller('threads', ['$scope', 'secrets', function($scope, secrets){

    // Recursively gather a thread of secrets from a root secret.
    function threadsecrets(secret, isunviewed){
        if(typeof isunviewed === 'undefined'){
            isunviewed = (typeof secret.body === 'undefined');
        }else if((typeof secret.body === 'undefined') !== isunviewed) return [];
        var members = [secret];
        each(secret.children, function(child){
            members = members.concat(threadsecrets(child, isunviewed));
        });
        return members;
    }

    // Create a thread object from a root secret.
    function Thread(secret){
        this.members = threadsecrets(secret);
        this.root = secret;
        if(secret.view === true){
            try{
                this.name = secret.body.match(/^[^\n]{0,20}($|[\n\s])/)[0];
            }catch(e){
                if(e instanceof TypeError){
                    this.name = secret.body.slice(0,20);
                }else throw e;
            }
        }

        var viewers = []
        eachval(this.root.viewers, function(viewerids){
            each(viewerids, function(viewerid){
                if(viewers.indexOf(viewerid) < 0) viewers.push(viewerid);
            });
        });
        this.viewers = viewers;
    }

    // Pull threads off checklist till we run out of unthreaded secrets.
    var
        checklist = secrets.keys(),
        threads = [], unviewed = [],
        secret, thread
    ;
    while(checklist.length > 0){
        secret = secrets.get(checklist.shift());
        thread = new Thread(secret);
        each(thread.members, function(member){
            var pos = checklist.indexOf(member.id);
            if(pos > -1) checklist.splice(pos, 1);
        });

        if(secret.view === true){
            threads.unshift(thread);
        }else{
            if(secret.parent){
                if(secret.parent.view === true) unviewed.unshift(thread);
            }else{
                eachval(secret.viewers, function(viewerslist, secretid){
                    if(secretid <= secret.id){
                        if(viewerslist.indexOf(secrets.me) > -1){
                            unviewed.unshift(thread);
                            return false;
                        }
                    }else{
                        if(secrets.get(secretid).view === true){
                            unviewed.unshift(thread);
                            return false;
                        }
                    }
                });
            }
        }
    }

    $scope.secrets = window.s = secrets;
    $scope.threads = window.t = threads;
    $scope.unviewed = window.u = unviewed;

    // FIXME find me a place.
    $scope.nojsstyle = 'display: none';

// A controller for composing secrets.
}]).controller('composer', ['$scope', '$http', function($scope, $http){

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
            url: 'post',
            method: 'post',
            params: {
                body: $scope.body,
                parentid: $scope.parentid,
                'authparentids[]': $scope.authparents,
                'authchildids[]': $scope.authchildren,
                'viewerids[]': $scope.viewers

            }
        }).success(function(data){
            console.log('gotit', arguments);
        }).error(function(data){
            console.log('server error:', arguments);
        });
    };
}]);

}());
