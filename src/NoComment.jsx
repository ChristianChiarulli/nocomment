import React, {useState, useEffect, useRef, useMemo} from 'react'
import {useDebounce} from 'use-debounce'
import {SimplePool, nip05, nip19} from 'nostr-tools'

import {normalizeURL, insertEventIntoDescendingList, getName} from './util'
import {Container} from './components'
import Thread, {computeThreads} from './Thread'
import {Editor} from './Editor'
import {RelayList} from './RelayList'

export function NoComment({
  url = normalizeURL(location.href),
  relays = [],
  owner,
  skip,
  publicKey,
  privateKey,
  customBase,
  placeholder
}) {
  let customBaseTag = useMemo(() => {
    if (customBase) {
      try {
        let {type, data} = nip19.decode(customBase)
        switch (type) {
          case 'note':
            return {
              ref: data,
              filter: {'#e': [data]},
              reference: ['e', data, '', 'root']
            }
          case 'nevent':
            return {
              ref: data.id,
              filter: {'#e': [data.id]},
              reference: ['e', data.id, data.relays[0] || '', 'root']
            }
          case 'naddr':
            const {kind, pubkey, identifier} = data
            return {
              ref: `${kind}:${pubkey}:${identifier}`,
              filter: {'#a': [`${kind}:${pubkey}:${identifier}`]},
              reference: [
                'a',
                `${kind}:${pubkey}:${identifier}`,
                data.relays[0] || '',
                'root'
              ]
            }
        }
      } catch (err) {
        return {
          filter: {'#e': [customBase]},
          reference: ['e', customBase, '', 'root']
        }
      }
    }
  }, [customBase])

  let ownerTag = null
  if (owner) {
    try {
      let {type, data} = nip19.decode(ownerTag)
      switch (type) {
        case 'npub':
          ownerTag = ['p', data]
          break
        case 'nprofile':
          ownerTag = ['p', data.pubkey]
          if (data.relays.length > 0) {
            ownerTag.push(data.relays[0])
          }
          break
      }
    } catch (err) {
      if (owner.match(/^[a-f0-9]{64}$/)) {
        ownerTag = ['p', owner]
      }
    }
  }

  const [baseTagImmediate, setBaseTag] = useState(customBaseTag)
  const [_publicKey, setPublicKey] = useState(publicKey)
  const [events, setEvents] = useState([])
  const [metadata, setMetadata] = useState({})
  const metadataFetching = useRef({})
  const pool = useRef(new SimplePool())
  const [baseTag] = useDebounce(baseTagImmediate, 1000)
  // const [events] = useDebounce(eventsImmediate, 1000, {leading: true})
  const threads = useMemo(() => {
    if (!baseTag) return
    return computeThreads(baseTag, events)
  }, [baseTag, events])
  const [_privateKey, setPrivateKey] = useState(privateKey)
  const [chosenRelays, setChosenRelays] = useState(relays)

  useEffect(() => {
    if (baseTag) return

    // search for the base event based on the #r tag (url)
    pool.current
      .querySync(chosenRelays, [
        {
          '#r': [url],
          kinds: [1]
        }
      ])
      .then(events => {
        if (events.length === 0) return

        setBaseTag({
          filter: {'#e': events.slice(0, 3).map(event => event.id)},
          reference: [
            'e',
            events[0].id,
            pool.current.seenOn(events[0].id)[0],
            'root'
          ]
        })
      })
  }, [chosenRelays.length])

  useEffect(() => {
    console.log('events changed: ', events)
  }, [events])

  useEffect(() => {
    if (!baseTag) return

    // query for comments
    let i = 0
    const h = pool.current.subscribeMany(
      chosenRelays,
      [
        {
          ...baseTag.filter,
          kinds: [1]
        }
      ],
      {
        onevent(event) {
          console.log('NEW EVENT: ', event)
          setEvents(events => insertEventIntoDescendingList(events, event))
          fetchMetadata(event.pubkey, i)
          i++
        },
        oneose() {
          h.close()
        }
      }
    )
    return () => {
      h.close()
    }
  }, [baseTag, chosenRelays.length])

  if (skip && skip !== '' && skip === location.pathname) {
    return
  }

  return (
    <Container>
      {editor()}

      <div>
        {threads?.map(thread => (
          <Thread
            key={thread.id}
            thread={thread}
            metadata={metadata}
            relays={chosenRelays}
            replyForm={editor}
          />
        ))}
      </div>
    </Container>
  )

  function editor(parentId) {
    let selfName = getName(metadata, _publicKey)
    return (
      <Editor
        setEvents={setEvents}
        fetchMetadata={fetchMetadata}
        publicKey={_publicKey}
        setPublicKey={setPublicKey}
        privateKey={_privateKey}
        setPrivateKey={setPrivateKey}
        baseTag={baseTag}
        ownerTag={ownerTag}
        url={url}
        setBaseTag={setBaseTag}
        pool={pool}
        parentId={parentId}
        relays={chosenRelays}
        placeholder={placeholder}
        settingsContent={
          <RelayList
            selfName={selfName}
            relays={chosenRelays}
            setRelays={setChosenRelays}
          />
        }
      />
    )
  }

  async function fetchMetadata(pubkey, delay = 0) {
    if (pubkey in metadata) return
    if (pubkey in metadataFetching.current) return
    metadataFetching.current[pubkey] = true
    await new Promise(resolve => setTimeout(resolve, delay * 200))

    let done = 0

    const h = pool.current.subscribeMany(
      chosenRelays,
      [{kinds: [0], authors: [pubkey]}],

      {
        onevent(event) {
          if (
            !metadata[pubkey] ||
            metadata[pubkey].created_at < event.created_at
          ) {
            setMetadata(curr => {
              try {
                return {
                  ...curr,
                  [pubkey]: {
                    ...JSON.parse(event.content),
                    created_at: event.created_at
                  }
                }
              } catch {
                return curr
              }
            })
          }
        },
        oneose() {
          h.close()
          done--
          if (done === 0) fetchNIP05(pubkey, metadata[pubkey])
        }
      }
    )
    done++
  }

  async function fetchNIP05(pubkey, meta) {
    if (meta && meta.nip05)
      nip05.queryProfile(meta.nip05).then(name => {
        if (name === meta.nip05) {
          setMetadata(curr => ({
            ...curr,
            [pubkey]: {...meta, nip05verified: true}
          }))
        }
      })
  }
}
