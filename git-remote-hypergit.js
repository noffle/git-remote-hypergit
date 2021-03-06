#!/usr/bin/env node

var path = require('path')
var fs = require('fs')
var toPull = require('stream-to-pull-stream')
var pull = require('pull-stream')
var hyperdb = require('hyperdb')
var Repo = require('hyperdb-git-repo')
var gitRemoteHelper = require('pull-git-remote-helper')
var discovery = require('discovery-swarm')
var swarmDefaults = require('dat-swarm-defaults')
var debug = require('debug')('git-remote-hypergit')
var envpaths = require('env-paths')('hypergit')
var mkdirp = require('mkdirp')
var tmpdir = require('os').tmpdir()
var ncp = require('ncp')

function swarmReplicate (db, cb) {
  var repoKey = db.key.toString('hex')
  debug('id', repoKey)
  console.error('Seeking peers..')
  var swarm = discovery(swarmDefaults({
    id: db.local.key
  }))
  swarm.listen(2341)  // TODO: pick free port
  swarm.join(repoKey)
  var seen = {}
  seen[db.local.key.toString('hex')] = true
  var active = []
  var done = new Buffer(1)
  var replicated = 0
  setTimeout(function () {
    if (!active.length && !replicated) {
      console.error('timeout (no peers available for this repo)')
      swarm.leave(repoKey)
      swarm.destroy(cb.bind(null, null, replicated))
    }
  }, 15000)
  swarm.on('connection', function (conn, info) {
    if (seen[key]) return
    seen[key] = true
    var key = info.id.toString('hex')

    debug('found peer', key)
    console.error('Replicating with peer..')

    var r = db.replicate({live:false})
    r.pipe(conn).pipe(r)
    active.push(key)

    r.once('end', function () {
      debug('done replicating', key)
      console.error('..done!')
      replicated++
      if (active.indexOf(key) === -1) return
      active.splice(active.indexOf(key), 1)
      if (!active.length) {
        swarm.leave(repoKey)
        swarm.destroy(cb.bind(null, null, replicated))
      }
    })
    r.once('error', function (err) {
      debug('failed replicating', key)
      console.error('..failed! (' + err.message + ')')
      if (active.indexOf(key) === -1) return
      active.splice(active.indexOf(key), 1)
      if (!active.length) {
        swarm.leave(repoKey)
        swarm.destroy(cb.bind(null, null, replicated))
      }
    })
  })
  /*
  // TODO: dont crash here on info.id === undefined
  swarm.on('connection-closed', function (conn, info) {
  console.log('info', info)
    var key = info.id.toString('hex')
    debug('lost connection ', key)
    if (active.indexOf(key) === -1) return
    console.error('..failed! (lost connection)')
    active.splice(active.indexOf(key), 1)
    if (!active.length) {
      swarm.leave(repoKey)
      swarm.destroy(cb.bind(null, null, replicated))
    }
  })
  */
}

var key = process.argv[3].replace('hypergit://', '')

var dbpath = path.join(envpaths.config, key)
var tmpdbpath = path.join(tmpdir, key + '-' + String(Math.random()).substring(3))

// Only consult the swarm on an initial 'git clone'
var doSwarm = true
if (fs.existsSync(dbpath)) doSwarm = false

mkdirp.sync(tmpdbpath)
var db = hyperdb(tmpdbpath, key)

db.ready(function () {
  if (doSwarm) swarmReplicate(db, done)
  else done(null, Infinity)

  function done (err, numReplicated) {
    if (!numReplicated) {
      console.error('Failed to find any peers for this repo.')
      return process.exit(1)
    }

    // make real repo + copy
    mkdirp.sync(dbpath)
    ncp(tmpdbpath, dbpath, function (err) {
      if (err) throw err
      var realdb = hyperdb(dbpath, key)
      pull(
        toPull(process.stdin),
        gitRemoteHelper(Repo(realdb)),
        toPull(process.stdout)
      )
    })
  }
})
