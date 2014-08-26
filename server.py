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
    secrets = {}
    for view in current_user.views:
        s = view.secret
        secrets[s.id] = {
            'id': s.id,
            'name': s.name,
            'time': s.time,
            'authorid': s.authorid,
            'parentid': s.parentid,
            'childids': [child.id for child in s.children],
            'viewers': {
                group: [viewer.id for viewer in viewers]
                for group, viewers in s.knownviewers(current_user).items()
            }
        }
        if view.viewed: secrets[s.id]['body'] = s.body

    return render_template('index.html', secrets=secrets)

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

if __name__ == '__main__':
    app.run(host='0.0.0.0')
