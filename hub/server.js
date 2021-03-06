// set NODE_ENV from argument to enable portability to windows
const yargs = require('yargs').argv
if (yargs.env !== undefined) {
  process.env.NODE_ENV = yargs.env
}

const TallyDriver = require('./lib/TallyDriver')
const Configuration = require('./lib/Configuration')
const MixerDriver = require('./lib/MixerDriver')
const express = require('express')
const app = express()
const server = require('http').Server(app)
const io = require('socket.io')(server)
const next = require('next')
const Log = require('./domain/Log')

const EventEmitter = require('events')
const SocketAwareEventPipe = require('./lib/SocketAwareEventPipe')

// - program.changed
// - tally.connected
// - tally.changed
// - tally.reported
// - tally.missing
// - tally.timedout
// - tally.removed
// - tally.logged
// - atem.connected
// - atem.disconnected
// - config.changed.mixer
// - config.changed.atem
// - config.changed.mock
const myEmitter = new EventEmitter()
myEmitter.setMaxListeners(99)
const myConfiguration = new Configuration(myEmitter)
const myMixerDriver = new MixerDriver(myConfiguration, myEmitter)
const myTallyDriver = new TallyDriver(myConfiguration.getTallies(), myEmitter)

const nextApp = next({ dev: myConfiguration.isDev() })
const nextHandler = nextApp.getRequestHandler()

// keep configruation up to date
const updateTallies = function() {
  myConfiguration.updateTallies(myTallyDriver)
  myConfiguration.save()
}
myEmitter.on('tally.connected', updateTallies)
myEmitter.on('tally.changed', updateTallies)
myEmitter.on('tally.removed', updateTallies)

const sendLogToTally = (tally, log) => {
  io.emit(`tally.logged.${tally.name}`, log)
}
const sendTalliesToBrowser = function() {
  io.emit('tallies', myTallyDriver.toValueObjects())
}
myEmitter.on('tally.connected', sendTalliesToBrowser)
myEmitter.on('tally.changed', sendTalliesToBrowser)
myEmitter.on('tally.logged', sendLogToTally)
myEmitter.on('tally.changed', (tally) => {
  io.emit(`tally.changed.${tally.name}`, myTallyDriver.toValueObjects())
})
myEmitter.on('tally.missing', sendTalliesToBrowser)
myEmitter.on('tally.missing', (tally, diff) => {
  const log = tally.addLog(new Date(), Log.STATUS, `Tally got missing. It has not reported for ${diff}ms`)
  sendLogToTally(tally, log)
})
myEmitter.on('tally.timedout', sendTalliesToBrowser)
myEmitter.on('tally.timedout', (tally, diff) => {
  const log = tally.addLog(new Date(), Log.STATUS, `Tally got disconnected after not reporting for ${diff}ms`)
  sendLogToTally(tally, log)
})
myEmitter.on('tally.removed', sendTalliesToBrowser)

myEmitter.on('config.changed', function() {
  io.emit('config', myConfiguration.mixerConfigToObject())
})

// send events to tallies
myEmitter.on('program.changed', ({programs, previews}) => {
  myTallyDriver.setState(programs, previews)
})
myEmitter.on('tally.connected', (tally) => myTallyDriver.updateTally(tally.name))
myEmitter.on('tally.changed', (tally) => myTallyDriver.updateTally(tally.name))

// log stuff
myEmitter.on('tally.connected', tally => {
    console.info(`Tally ${tally.name} connected`)
})
myEmitter.on('tally.changed', tally => {
    console.debug(`Tally ${tally.name} changed configuration`)
})
myEmitter.on('tally.missing', tally => {
    console.warn(`Tally ${tally.name} went missing`)
})
myEmitter.on('tally.timedout', tally => {
    console.warn(`Tally ${tally.name} timed out`)
})
myEmitter.on('tally.removed', tally => {
    console.debug(`Tally ${tally.name} removed from configuration`)
})
myEmitter.on('tally.logged', (tally, log) => {
    let fn = console.info
    if(log.isError()) { 
      fn = console.error 
    } else if(log.isWarning()) {
      fn = console.warn
    }
    fn(`${tally.name}: ${log.message}`)
})
myEmitter.on('config.changed.mixer', mixerSelection => {
    console.info(`configured mixer was changed to "${mixerSelection}"`)
})
myEmitter.on('config.changed.atem', () => {
    console.info("configuration of ATEM was changed")
})
myEmitter.on('config.changed.mock', () => {
    console.info("configuration of Mock was changed")
})
myEmitter.on('program.changed', ({programs, previews}) => {
    console.info("Program/Preview was changed to ", programs, previews)
})

// socket.io server
io.on('connection', socket => {
  socket.emit('tallies', myTallyDriver.toValueObjects())

  const mixerEvents = [
    // @TODO: use event objects instead of repeating the same structure again and again
    new SocketAwareEventPipe(myEmitter, 'mixer.connected', socket, (socket) => {
      socket.emit('mixer.state', {
        isMixerConnected: true
      })
    }),
    new SocketAwareEventPipe(myEmitter, 'mixer.disconnected', socket, (socket) => {
      socket.emit('mixer.state', {
        isMixerConnected: false
      })
    }),
  ]
  socket.on('events.mixer.subscribe', () => {
    mixerEvents.forEach(pipe => pipe.register())
    socket.emit('mixer.state', {
      isMixerConnected: myMixerDriver.isConnected()
    })
  })
  socket.off('events.mixer.unsubscribe', () => {
    // @TODO: not used yet
    mixerEvents.forEach(pipe => pipe.unregister())
  })

  const programEvents = [
    new SocketAwareEventPipe(myEmitter, 'program.changed', socket, (socket, {programs, previews}) => {
      socket.emit('program.state', {
        programs: programs,
        previews: previews,
      })
    })
  ]
  socket.on('events.program.subscribe', () => {
    programEvents.forEach(pipe => pipe.register())

    socket.emit('program.state', {
      programs: myMixerDriver.getCurrentPrograms(),
      previews: myMixerDriver.getCurrentPreviews(),
    })
  })
  socket.on('events.program.unsubscribe', () => {
    // @TODO: not used yet
    programEvents.forEach(pipe => pipe.unregister())
  })

  socket.on('tally.patch', (tallyName, channelId) => {
    myTallyDriver.patchTally(tallyName, channelId)
  })
  socket.on('tally.highlight', (tallyName) => {
    myTallyDriver.highlight(tallyName)
  })
  socket.on('tally.remove', tallyName => {
    myTallyDriver.removeTally(tallyName)
  })
  socket.on('config.changeRequest', (selectedMixer, atemIp, atemPort, vmixIp, vmixPort, obsIp, obsPort, mockTickTime, mockChannelCount, mockChannelNames) => {
    myConfiguration.updateAtemConfig(atemIp, atemPort)
    myConfiguration.updateVmixConfig(vmixIp, vmixPort)
    myConfiguration.updateObsConfig(obsIp, obsPort)
    myConfiguration.updateMockConfig(mockTickTime, mockChannelCount, mockChannelNames)
    myConfiguration.updateMixerSelection(selectedMixer)
    myConfiguration.save()
    myEmitter.emit("config.changed")
  })
})

nextApp.prepare().then(() => {
  app.get('/tallies', (req, res) => {
    res.json({
      tallies: myTallyDriver.toValueObjects(),
    })
  })
  app.get('/tally', (req, res) => {
    const tally = myTallyDriver.getTally(req.query.tallyName)
    res.json({
      tally: tally.toValueObject(),
      logs: tally.getLogs().map(log => log.toValueObject()),
    })
  })
  app.get('/atem', (req, res) => {
    const data = myConfiguration.mixerConfigToObject()
    data.allowedMixers = MixerDriver.getAllowedMixers(myConfiguration.isDev())
    res.json(data)
  })

  app.use('/lato', express.static(__dirname + '/node_modules/lato-font/css/'));
  app.use('/fonts', express.static(__dirname + '/node_modules/lato-font/fonts/'));

  app.get('*', (req, res) => {
    return nextHandler(req, res)
  })

  server.listen(myConfiguration.getHttpPort(), err => {
    if (err) throw err
    console.log(`Web Server available on http://localhost:${myConfiguration.getHttpPort()}`)
  })
})
