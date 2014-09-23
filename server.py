#!/usr/bin/python3

import db

from werkzeug.exceptions import BadRequest
from flask import(
        Flask,
        abort,
        current_app,
        flash,
        g,
        get_flashed_messages,
        json,
        make_response,
        redirect,
        render_template,
        request,
        session,
        url_for,
)
app = Flask(__name__)
app.config.update(
    SECRET_KEY = 'OTP',
    DEBUG = True
)

from flask_login import(
    LoginManager,
    login_required,
    login_user,
    logout_user,
    current_user
)
loginmanager = LoginManager()
loginmanager.init_app(app)
loginmanager.login_view = 'login'
@loginmanager.user_loader
def load_user(userid):
    return db.Viewer.getbyid(userid)

# FIXME Once wefinish debuging, this should only work with POST.
@app.route('/login', methods=['GET', 'POST'])
def login():
    logout_user()
    session.clear()
    if not 'passphrase' in request.values:
        return render_template('login.html')
    if 'name' in request.values:
        user = db.Viewer(request.values['name'], request.values['passphrase'])
    else:
        user = db.Viewer.getbypass(request.values['passphrase'])
    if user is None:
        flash('New user')
        return render_template('login.html')
    try: login_user(user)
    except AttributeError: flash('Bad login')
    return redirect(request.values.get('next', url_for('index')))

def jsonable(view):
    secret = view.secret
    jsonable = {
        'id': secret.id,
        'time': secret.time,
        'authorid': secret.authorid,
        'childids': [
            child.id
            for child in secret.children
            if db.View.get(current_user.id, child.id)
        ],
        'viewers': {
            group: [viewer.id for viewer in viewers]
            for group, viewers in secret.knownviewers(current_user).items()
        }
    }
    if db.View.get(current_user.id, secret.parentid):
        jsonable['parentid'] = secret.parentid
    if view.viewed:
        jsonable['body'] = secret.body
    return jsonable

@app.route('/')
@login_required
def index():
    return render_template('index.html',
            viewers=db.Viewer.getall(),
            secrets=[jsonable(view) for view in current_user.views]
    )

from functools import wraps
def jsonp(f):
    @wraps(f)
    def wraped(*args, **kwargs):
        data = json.dumps(f(*args, **kwargs), indent=4)
        mimetype = 'application/'
        try:
            data = "%s(%s)" % (request.values['callback'], data)
            mimetype += 'javascript'
        except BadRequest as e:
            mimetype += 'json'
        return current_app.response_class(data, mimetype=mimetype)
    return wraped

@app.route('/secret', methods=['GET', 'POST'])
@login_required
@jsonp
def getsecret():
    view = db.View.get(current_user.id, request.values['id'], None, True)
    if not view: return {'error': 'unauthorized'}
    return jsonable(view)

@app.route('/post', methods=['GET', 'POST'])
@login_required
@jsonp
def postsecret():
    return {
        'posttime':
            db.Secret(
                request.values.get('body'),
                current_user.id,
                request.values.get('parentid'),
                request.values.getlist('viewerids[]'),
                request.values.getlist('authparentids[]'),
                request.values.getlist('authchildids[]')
            ).time
    }

if __name__ == '__main__':
    from sys import argv
    try: app.run(host='0.0.0.0', port=int(argv[1]))
    except: app.run(host='0.0.0.0')
