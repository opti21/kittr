import { prisma } from "../index"
import mongoose from "mongoose"

import { KitOption } from "../models/KitOption"
import { Game } from "../models/Game"
import { KitBase } from "../models/KitBase"
import { Channel } from "../models/Channel"

console.time("Script Main")
mongoose
	.connect(process.env.MONGOOSE_CONNECTION_STRING as string, {
		authSource: "admin"
	})
	.then(async () => {
		console.log("Connected to MongoDB")
		// Pick up all the data that I will be needing once
		const mongoGames = await Game.find({}).lean()
		const mongoBases = await KitBase.find({}).lean()
		const mongoOptions = await KitOption.find({}).lean()
		const mongoChannels = await Channel.find({}).lean()

		const createGames = async () => {
			for (const game of mongoGames) {
				await prisma.game.create({
					data: {
						id: game._id.toString(),
						displayName: game.displayName,
						urlSafeName: game.urlSafeName,
						backgroundImageUrl: game.backgroundImage,
						titleImageUrl: game.titleImage,
						active: game.active,
						blurDataUrl: game.blurDataURL,
						developer: game.developer,
						releaseDate: game.releaseDate,
						platforms: {
							connectOrCreate: [
								...game.platforms.map((platform) => ({
									where: { displayName: platform },
									create: { displayName: platform }
								}))
							]
						},
						genres: {
							connectOrCreate: [
								...game.genres.map((genre) => ({
									where: { displayName: genre },
									create: { displayName: genre }
								}))
							]
						}
					}
				})
			}
		}

		const createKitBases = async () => {
			const formattedBases = mongoBases.map((base) => ({
				...base,
				id: base._id.toString(),
				gameInfo: {
					...base.gameInfo,
					availableOptions: base.gameInfo.availableOptions.map((option) => {
						const foundOption = mongoOptions.find((o) => {
							return o._id.toString() === option.optionId.toString()
						})

						return {
							orderPlacement: Number(option.orderPlacement) * 10,
							gameId: (foundOption as any).gameId.toString(),
							displayName: (foundOption as any).displayName,
							slotKey: (foundOption as any).slotKey
						}
					})
				}
			}))

			for (const base of formattedBases) {
				await prisma.kitBase.create({
					data: {
						id: base._id.toString(),
						displayName: base.displayName,
						imageUrl: base.image,
						blurb: base.gameInfo.blurb,

						maxOptions: base.gameInfo.maxOptions,
						game: {
							connect: {
								id: base.gameId.toString()
							}
						},
						commandCodes: {
							create: base.commandCodes.map((code) => ({
								code: code
							}))
						},
						stats: {
							create: Object.entries(base.gameInfo.stats).map((stat) => {
								const [key, value] = stat

								return {
									displayName: key,
									value: String(value)
								}
							})
						},
						availableOptions: {
							create: base.gameInfo.availableOptions
						},
						category: {
							connectOrCreate: {
								where: { displayName: base.category },
								create: { displayName: base.category }
							}
						}
					}
				})
			}
		}

		const createChannels = async () => {
			const formattedChannels = mongoChannels.map((channel) => ({
				id: channel._id.toString(),
				createdAt: channel._id.getTimestamp(),
				displayName: channel.displayName,
				urlSafeName: channel.urlSafeName,
				viewCount: channel.viewCount,
				previousUpdater: channel.previousUpdater,
				games: channel.games
			}))

			for (const channel of formattedChannels) {
				await prisma.channel.create({
					data: {
						...channel,
						games: {
							connect: channel.games.map((game) => ({ id: game.id.toString() }))
						},
						gameAffiliateCodes: {
							create: channel.games
								.filter((game) => !!game.code)
								.map((game) => {
									return {
										gameId: game.id.toString(),
										code: game.code!
									}
								})
						},
						customGameCommands: {
							create: channel.games
								.filter((game) => !!game.commandString)
								.map((game) => {
									return {
										game: { connect: { id: game.id.toString() } },
										command: game.commandString!
									}
								})
						}
					}
				})
			}
		}

		const createKits = async () => {
			// I need the new options from postgres so I can use their ids
			const newOptions = await prisma.kitOption.findMany({
				include: { kit: true }
			})

			// Every kit is for Warzone right now so this is applicable
			const warzoneId = mongoGames
				.find((game) => game.displayName === "Warzone")!
				._id.toString()

			// The kits to map over for our creates
			const allKits = mongoChannels
				.map((channel) =>
					channel.kits.map((kit) => ({
						...kit,
						channelId: channel._id.toString(),
						id: kit._id.toString(),
						options: kit.options
							.map((opt) => {
								const optionId = opt._id.toString()
								const info = mongoOptions.find(
									(o) => o._id.toString() === optionId
								)!

								const newOptionId = newOptions.find((o) => {
									const displayNameMatch = o.displayName === info.displayName
									const baseIdMatch = kit.baseId === o.kit.id

									return displayNameMatch && baseIdMatch
								})

								return newOptionId?.id || undefined
							})
							.filter((opt) => !!opt),
						gameId: warzoneId
					}))
				)
				.flat()

			for (const kit of allKits) {
				await prisma.kit.create({
					data: {
						id: kit.id,
						customTitle: kit.userData.customTitle,
						blueprint: kit.userData.blueprint,
						featured: kit.userData.featured,
						youtubeUrl: kit.userData.youtubeURL,
						tiktokUrl: kit.userData.tiktokId,
						quote: kit.userData.quote,
						game: {
							connect: { id: warzoneId! }
						},
						kitBase: {
							connect: {
								id: kit.baseId
							}
						},
						channel: {
							connect: {
								id: kit.channelId
							}
						},
						options: {
							connect: kit.options.map((opt) => ({ id: opt }))
						}
					}
				})
			}
		}

		const main = async () => {
			console.time("Creating games")
			await createGames()
			console.timeEnd("Creating games")

			console.time("Creating kit bases")
			await createKitBases()
			console.timeEnd("Creating kit bases")

			console.time("Creating channels")
			await createChannels()
			console.timeEnd("Creating channels")

			console.time("Creating kits")
			await createKits()
			console.timeEnd("Creating kits")
		}

		main()
			.catch((e) => {
				console.error(e)
				process.exit(1)
			})
			.finally(async () => {
				await prisma.$disconnect()
				await mongoose.connection.close()
				console.log(
					"Dun. You are a good person and I hope that you achieved your goal for this run."
				)
				console.timeEnd("Script Main")
			})
	})
