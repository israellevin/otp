#!/usr/bin/python3

# Default local db for testing, set the env variable to override.
dbfilename = 'otp.db'
dbscheme = 'sqlite'
from os import environ
dburl = environ.get('DATABASE_URL', "%s:///%s" % (dbscheme, dbfilename))

from sqlalchemy import create_engine, event
from sqlalchemy.orm import scoped_session, sessionmaker, mapper
engine = create_engine(dburl)
session = scoped_session(sessionmaker(bind = engine))
@event.listens_for(mapper, 'init')
def auto_add(target, args, kwargs):
    session.add(target)

from sqlalchemy.ext.declarative import declarative_base
Base = declarative_base()
Base.query = session.query_property()

from sqlalchemy import(
    Table,
    Column,
    Integer,
    String,
    Boolean,
    ForeignKey,
    exc
)
from sqlalchemy.types import UnicodeText, DateTime, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime

from flask_login import UserMixin
class Viewer(Base, UserMixin):
    __tablename__ = 'viewers'
    id = Column(Integer, primary_key=True)
    name = Column(String(64))
    lastseen = Column(DateTime)

    def __init__(self, name):
        self.name = name
        self.lastseen = datetime.now()
        session.flush()

    def __repr__(self):
        return 'u:' + self.name

    @classmethod
    def getbyid(cls, id):
        try: return session.query(cls).filter_by(id=id).one()
        except exc.SQLAlchemyError: return None

class View(Base):
    __tablename__ = 'views'
    id = Column(Integer, primary_key=True)
    secretid = Column(Integer, ForeignKey('secrets.id'))
    viewerid = Column(Integer, ForeignKey('viewers.id'))
    personal = Column(Boolean)
    viewed = Column(DateTime)

    secret = relationship('Secret', backref='views')
    viewer = relationship('Viewer', backref='views')

    def __init__(self, secret, viewer):
        self.secretid, self.viewerid = secret.id, viewer.id
        session.flush()

    def __repr__(self):
        return "v:%s->%s" % (self.viewer.name, self.secret.name)

    @classmethod
    def get(cls, secret, viewer, personal=None, viewed=None):
        try: view = session.query(cls).filter_by(
            secretid=secret.id, viewerid=viewer.id
        ).one()
        except exc.SQLAlchemyError: view = cls(secret, viewer)
        if personal is not None: view.personal = personal
        if viewed is not None: view.viewed = viewed
        if None not in (personal, viewed): session.flush()

class Revelation(Base):
    __tablename__ = 'revelations'
    id = Column(Integer, primary_key=True)
    revealedid = Column(Integer, ForeignKey('secrets.id'))
    revealerid = Column(Integer, ForeignKey('secrets.id'))
    public = Column(Boolean, default=False)

    def __init__(self, revealed, revealer, public=None):
        self.revealedid, self.revealerid = revealed.id, revealer.id
        if public is not None: self.public = public
        revealed.reveal(revealer.viewers)

    def __repr__(self):
        return "r:%s->%s" % (self.revealer.name, self.revealed.name)

class Secret(Base):
    __tablename__ = 'secrets'
    id = Column(Integer, primary_key=True)
    time = Column(DateTime)
    name = Column(String(256))
    body = Column(UnicodeText)

    authorid = Column(Integer, ForeignKey('viewers.id'))
    parentid = Column(Integer, ForeignKey('secrets.id'))

    author = relationship('Viewer')
    parent = relationship('Secret', remote_side=[id], backref='children')
    viewers = relationship('Viewer', secondary='views', backref='secrets')
    personalviewers = relationship(
        'Viewer',
        secondary='views',
        primaryjoin='''and_(
            Secret.id == View.secretid,
            View.personal == True
        )'''
    )
    authparents = relationship(
        'Secret',
        secondary='revelations',
        primaryjoin=id==Revelation.revealedid,
        secondaryjoin=id==Revelation.revealerid,
        backref='authchildren'
    )
    publicauthparents = relationship(
        'Secret',
        secondary='revelations',
        primaryjoin='''and_(
            Secret.id == Revelation.revealedid,
            Revelation.public == True
        )''',
        secondaryjoin=id==Revelation.revealerid
    )
    privateauthparents = relationship(
        'Secret',
        secondary='revelations',
        primaryjoin='''and_(
            Secret.id == Revelation.revealedid,
            Revelation.public == False
        )''',
        secondaryjoin=id==Revelation.revealerid
    )

    def __init__(
        self, name, body, author,
        parent=None, viewers=[], revealed=[]
    ):
        self.time = datetime.now()
        self.name, self.body = name, body
        self.authorid = author.id
        if parent is not None: self.parentid = parent.id
        session.flush()

        View.get(self, author, True, self.time)
        for viewer in viewers:
            if type(viewer) is Viewer: View.get(self, viewer, True)
            elif type(viewer) is Secret: Revelation(self, viewer, True)
        for secret in revealed: Revelation(secret, self)
        session.flush()

    def reveal(self, viewers):
        for viewer in viewers:
            View.get(self, viewer)
        for child in self.authchildren: child.reveal(viewers)
        session.flush()

    def knownviewers(self, viewer, ignore=None):
        if ignore is None: ignore = []
        elif self in ignore: return []
        ignore.append(self)
        viewers = {self.id: self.personalviewers[:]}
        for secret in self.publicauthparents:
            viewers.update(secret.knownviewers(viewer, ignore))
        for secret in self.privateauthparents:
            if viewer in secret.viewers:
                viewers.update(secret.knownviewers(viewer, ignore))
        return viewers

    def __repr__(self):
        return 's:' + self.name

if __name__ == '__main__':

    from os.path import isfile
    if isfile(dbfilename):
        if 'y' != input('Delete database and create a new one? (y/N): '):
            from sys import exit
            exit(0)
        from os import remove
        remove(dbfilename)

    Base.metadata.create_all(bind=engine)
    us = []
    us.append(Viewer('israel'))
    us.append(Viewer('ghoula'))
    us.append(Viewer('xbu'))
    us.append(Viewer('xao'))
    ss = []
    ss.append(Secret('private from i to g', 'actual content', us[0], None, [us[1]]))
    ss.append(Secret('g tells xbu about 0', 'not much', us[1], ss[0], [us[2]], [ss[0]]))
    ss.append(Secret('g tells xao about 0', 'even less', us[1], ss[1], [us[3]], [ss[0]]))
    ss.append(Secret('gs char sheet', 'lesser', us[1], None, [us[0]]))
    session.commit()

    for u in us:
        print('User', u.name)
        print()
        for s in u.secrets:
            print(s)
            print(s.knownviewers(u))
            print()
        print()
