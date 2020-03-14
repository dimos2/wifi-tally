import { useState } from 'react'
import fetch from 'isomorphic-unfetch'
import {useSocket} from '../hooks/useSocket'
import Layout from '../components/Layout'

const mixerLabels = {
  mock: "Built-In Mock for testing",
  atem: "ATEM by Blackmagic Design",
  "null": "Off",
}

const Config = props => {
  const allowedMixers = props.allowedMixers
  const [currentMixerId, setCurrentMixerId] = useState(props.currentMixerId)
  const [atemIp, setAtemIp] = useState(props.atem.ip)
  const [atemPort, setAtemPort] = useState(props.atem.port)
  const [mockTickTime, setMockTickTime] = useState(props.mock.tickTime)

  const socket = useSocket('config', config => {
    setCurrentMixerId(config.currentMixerId)
    setAtemIp(config.atem.ip)
    setAtemPort(config.atem.port)
    setMockTickTime(config.mock.tickTime)
  })

  const handleSubmit = e => {
    socket.emit('config.changeRequest', currentMixerId, atemIp, atemPort, mockTickTime)
    e.preventDefault()
  }

  const addMixerOption = function(id) {
    const label = mixerLabels[id]
    return (
      <option key={id} value={id}>{label}</option>
    )
  }

  return (
    <Layout>
      <div className="page card">
        <h4 className="card-header">Video Mixer</h4>
        <div className="card-body">
          <p>
            Select a Video Mixer to use.
          </p>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
            <select className="form-control" value={currentMixerId} onChange={e => setCurrentMixerId(e.target.value)}>
              {allowedMixers.map(addMixerOption)}
            </select>
          </div>
            {currentMixerId == "mock" ? (
              <fieldset>
                <legend>Mock Configuration</legend>
                <p className="text-muted">
                  This simulates a Video Mixer by changing the channels randomly at a fixed time interval.
                  It is intended for development, when you do not have a video mixer at hand, but serves
                  no purpose in productive environments.
                </p>
                <div className="form-group">
                  <label htmlFor="mock-tickTime">Change program every ms</label>
                  <input className="form-control" id="mock-tickTime" type="text" value={mockTickTime} onChange={e => setMockTickTime(e.target.value)} />
                </div>
              </fieldset>
            ): ""}
            {currentMixerId == "atem" ? (
              <fieldset>
                <legend>ATEM Configuration</legend>
                <p className="text-muted">
                  Connects to any ATEM device over network.
                </p>
                <div className="form-group">
                  <label htmlFor="atem-ip">ATEM IP</label>
                  <input className="form-control" id="atem-ip" type="text" value={atemIp} onChange={e => setAtemIp(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="atem-port">ATEM Port</label>
                  <input className="form-control" id="atem-port" type="text" value={atemPort} onChange={e => setAtemPort(e.target.value)} />
                </div>
              </fieldset>
            ) : ""}
            {currentMixerId == "null" ? (
              <fieldset>
                <p className="text-muted">This cuts the connection to any video mixer.</p>
              </fieldset>
            ) : ""}
            <button type="submit" className="btn btn-primary">Save</button>
          </form>
          </div>
      </div>
    </Layout>
  )
}

Config.getInitialProps = async () => {
  const response = await fetch('http://localhost:3000/atem')
  const info = await response.json()

  return info
}

export default Config;