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
        return func(dictionary[key]);
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
}

// A secrets service to enhance and serve the server injected secrets.
angular.module('otp', []).service('secrets', ['$window', '$http', function(
    $window, $http
){
    var viewers = copy($window.rawviewers);
    var me = viewers[$window.uid];

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
    // TODO Should this not be a SortDict as well?
    function threadsecrets(secret){
        if(typeof secret.body === 'undefined') return [];
        var members = [secret];
        each(secret.children, function(child){
            members = members.concat(threadsecrets(child));
        });
        return members;
    }

    // Create a thread object from a list of members.
    function Thread(members){
        this.members = members;

        this.viewed = this.members.every(function(member){
            return typeof member.body === 'string';
        });

        try{
            this.name = this.members[0].body.match(/^[^\n]{0,20}($|[\n\s])/)[0];
        }catch(e if e instanceof TypeError){
            this.name = this.members[0].body.slice(0,20);
        }

        var viewers = []
        eachval(this.members[0].viewers, function(viewerids){
            each(viewerids, function(viewerid){
                if(viewers.indexOf(viewerid) < 0) viewers.push(viewerid);
            });
        });
        this.viewers = viewers;
    }

    // Pull threads off checklist till we run out of unthreaded secrets.
    var root, members, unviewed = [], threads = [], checklist = secrets.keys();
    var checklist = secrets.keys(), threads = [], unviewed = [], root, members;
    while(checklist.length > 0){
        root = secrets.get(checklist.shift());
        members = threadsecrets(root);
        if(members.length > 0){
            threads.unshift(new Thread(members));
            each(members, function(member){
                var pos = checklist.indexOf(member.id);
                if(pos > -1) checklist.splice(pos, 1);
            });
        }else unviewed.unshift(root);
    }

    $scope.secrets = window.s = secrets;
    $scope.threads = window.t = threads;
    $scope.unviewed = window.u = unviewed;

    $scope.nojsstyle = 'display: none';
}]).controller('composer', ['$scope', '$http', function($scope, $http){

    // TODO directivise this shit.
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
