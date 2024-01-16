import React from 'react'
import {GhostButton} from './components'


const ReplyButton = ({onClick}) => {
  return (
    <GhostButton type="button" onClick={onClick} aria-label="reply button">
      reply
    </GhostButton>
  )
}

export default ReplyButton
