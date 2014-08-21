#!/usr/bin/python3

import db

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

@app.route('/login', methods=['GET', 'POST'])
def login():
    if not 'uid' in request.args:
        return ''.join([
            "<div>%s</div>" % message for message in get_flashed_messages()
        ]) + '''
            <form>
                <input name=uid autofocus>
                <input name=next type=hidden value="%s">
            </form>
        ''' % (request.args.get('next') or '',)
    user = db.Viewer.getbyid(request.args['uid'])
    try: login_user(user)
    except AttributeError: flash('Bad login')
    return redirect(request.args.get('next') or url_for('index'))

@app.route('/logout')
def logout():
    logout_user()
    session.clear()
    return redirect(request.args.get('next') or url_for('index'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

from functools import wraps
def jsonp(f):
    @wraps(f)
    def wraped(*args, **kwargs):
        data = json.dumps(f(*args, **kwargs), indent=4)
        mimetype = 'application/'
        callback = request.values.get('callback', False)
        if callback:
            data = "%s(%s)" % (str(callback), data)
            mimetype += 'javascript'
        else:
            mimetype += 'json'
        return current_app.response_class(data, mimetype=mimetype)
    return wraped

@app.route('/secrets', methods=['GET', 'POST'])
@login_required
@jsonp
def secrets():
    secrets = {}
    for view in current_user.views:
        secret = view.secret
        secrets[secret.id] = {
            'name': secret.name,
            'time': secret.time,
            'author': secret.authorid,
            'parent': secret.parentid,
            'children': [child.id for child in secret.children]
        }
        if view.viewed:
            secrets[secret.id]['body'] = secret.body
    return secrets

if __name__ == '__main__':
    app.run(host='0.0.0.0')
